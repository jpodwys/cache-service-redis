var redis = require('redis');

function retryStrategy (options) {
  if (options.attempt > 5) {
      // End reconnecting with built in error
      return undefined;
  }
  // Add a bit of a delay
  return Math.min(options.attempt * 100, 3000);
}

/**
 * redisCacheModule constructor
 * @constructor
 * @param config: {
 *    type:                           {string | 'redis'}
 *    verbose:                        {boolean | false},
 *    expiration:                     {integer | 900},
 *    readOnly:                       {boolean | false},
 *    checkOnPreviousEmpty            {boolean | true},
 *    backgroundRefreshIntervalCheck  {boolean | true},
 *    backgroundRefreshInterval       {integer | 60000},
 *    backgroundRefreshMinTtl         {integer | 70000},
 *    redisData:                      {object},
 *    redisUrl:                       {string},
 *    redisEnv:                       {string}
 * }
 */
function redisCacheModule(config){
  var self = this;
  config = config || {};
  self.verbose = config.verbose || false;
  self.defaultExpiration = config.defaultExpiration || 900;
  self.readOnly = (typeof config.readOnly === 'boolean') ? config.readOnly : false;
  self.checkOnPreviousEmpty = (typeof config.checkOnPreviousEmpty === 'boolean') ? config.checkOnPreviousEmpty : true;
  self.backgroundRefreshIntervalCheck = (typeof config.backgroundRefreshIntervalCheck === 'boolean') ? config.backgroundRefreshIntervalCheck : true;
  self.backgroundRefreshInterval = config.backgroundRefreshInterval || 60000;
  self.backgroundRefreshMinTtl = config.backgroundRefreshMinTtl || 70000;
  self.JSON = config.JSON || Object.create(JSON);
  self.logJsonParseFailures = config.logJsonParseFailures || false;
  self.nameSpace = config.nameSpace || '';

  var refreshKeys = {};
  var backgroundRefreshEnabled = false;

  var noop = function(){};

  /**
   * Instantates an Exception to be thrown
   * @param {string} name
   * @param {string} message
   * @return {Exception}
   */
  function Exception(name, message){
    this.name = name;
    this.message = message;
  }

  /**
   * Error logging logic
   * @param {boolean} isError
   * @param {string} message
   * @param {object} data
   */
  function log(isError, message, data){
    var indentifier = 'redisCacheModule: ';
    if(self.verbose || isError){
      if(data) {
        console.log(indentifier + message, data);
      } else {
        console.log(indentifier + message);
      }
    }
  }

  /**
   * Handle the refresh callback from the consumer, save the data to redis.
   *
   * @param {string} key The key used to save.
   * @param {Object} data refresh keys data.
   * @param {Error|null} err consumer callback failure.
   * @param {*} response The consumer response.
   */
  function handleRefreshResponse (key, data, err, response) {
    if(!err) {
      this.set(key, response, data.lifeSpan, data.refresh, noop);
    }
  }

  /**
   * Refreshes all keys that were set with a refresh function
   */
  function backgroundRefresh() {
    var keys = Object.keys(refreshKeys);
    keys.forEach(function(key) {
      var data = refreshKeys[key];
      if(data.expiration - Date.now() < this.backgroundRefreshMinTtl){
        data.refresh(key, handleRefreshResponse.bind(this, key, data));
      }
    }, self);
  }

  /**
   * Initialize background refresh
   */
  function backgroundRefreshInit(){
    if(!backgroundRefreshEnabled){
      backgroundRefreshEnabled = true;
      if(self.backgroundRefreshIntervalCheck){
        if(self.backgroundRefreshInterval > self.backgroundRefreshMinTtl){
          throw new Exception('BACKGROUND_REFRESH_INTERVAL_EXCEPTION', 'backgroundRefreshInterval cannot be greater than backgroundRefreshMinTtl.');
        }
      }
      setInterval(function(){
        backgroundRefresh();
      }, self.backgroundRefreshInterval);
    }
  }

  /**
   * Prefix key with namespace
   * @param {string} key
   */
  function prefixKey(key) {
    if (self.nameSpace.length > 0 && !key.startsWith(self.nameSpace)) {
      return `${self.nameSpace}:${key}`
    }
    return key;
  }

  /**
   ******************************************* PUBLIC FUNCTIONS *******************************************
   */

  /**
   * Get the value associated with a given key
   * @param {string} key
   * @param {function} cb
   * @param {string} cleanKey
   */
  self.get = function(key, cb, cleanKey){
    if(arguments.length < 2){
      throw new Exception('INCORRECT_ARGUMENT_EXCEPTION', '.get() requires 2 arguments.');
    }
    log(false, 'get() called:', {key: key});
    try {
      var cacheKey = (cleanKey) ? cleanKey : prefixKey(key);
      log(false, 'Attempting to get key:', {key: cacheKey});
      self.db.get(cacheKey, function(err, result){
        try {
          result = self.JSON.parse(result);
        } catch (err) {
          if(self.logJsonParseFailures) {
            log(true, 'Error parsing JSON, err:', err);
          }
        }
        cb(err, result);
      });
    } catch (err) {
      cb({name: 'GetException', message: err}, null);
    }
  };

  /**
   * Get multiple values given multiple keys
   * @param {array} keys
   * @param {function} cb
   * @param {integer} index
   */
  self.mget = function(keys, cb, index){
    if(arguments.length < 2){
      throw new Exception('INCORRECT_ARGUMENT_EXCEPTION', '.mget() requires 2 arguments.');
    }
    cacheKeys = keys.map(prefixKey);
    log(false, '.mget() called:', {keys: keys});
    self.db.mget(cacheKeys, function (err, response){
      var obj = {};
      for(var i = 0; i < response.length; i++){
        if(response[i] !== null){
          try {
            response[i] = self.JSON.parse(response[i]);
          } catch (err) {
            if(self.logJsonParseFailures) {
              log(true, 'Error parsing JSON, err:', err);
            }
          }
          obj[keys[i]] = response[i];
        }
      }
      cb(err, obj, index);
    });
  };

  /**
   * Associate a key and value and optionally set an expiration
   * @param {string} key
   * @param {string | object} value
   * @param {integer} expiration
   * @param {function} refresh
   * @param {function} cb
   */
  self.set = function(){
    if(arguments.length < 2){
      throw new Exception('INCORRECT_ARGUMENT_EXCEPTION', '.set() requires a minimum of 2 arguments.');
    }
    var key = arguments[0];
    var value = arguments[1];
    var expiration = arguments[2] || null;
    var refresh = (arguments.length === 5) ? arguments[3] : null;
    var cb = (arguments.length === 5) ? arguments[4] : arguments[3];
    cb = cb || noop;
    log(false, '.set() called:', {key: key, value: value});
    try {
      if(!self.readOnly){
        expiration = expiration || self.defaultExpiration;
        var exp = (expiration * 1000) + Date.now();
        if(typeof value === 'object'){
          try {
            value = self.JSON.stringify(value);
          } catch (err) {
            if(self.logJsonParseFailures) {
              log(true, 'Error converting to JSON, err:', err);
            }
          }
        }
        var cacheKey = prefixKey(key);
        if(refresh){
          self.db.set(cacheKey, value, 'nx', 'ex', expiration, function (err, response){

            refreshKeys[key] = {expiration: exp, lifeSpan: expiration, refresh: refresh};

            if(!err && response){
              cb(err, response);
              backgroundRefreshInit();
            }
            else{
              self.db.setex(key, expiration, value, cb);
            }
          });
        }
        else{
          self.db.setex(cacheKey, expiration, value, cb);
        }
      }
    }catch (err) {
      log(true, '.set() failed for cache of type ' + self.type, {name: 'RedisSetException', message: err});
    }
  };

  /**
   * Associate multiple keys with multiple values and optionally set expirations per function and/or key
   * @param {object} obj
   * @param {integer} expiration
   * @param {function} cb
   */
  self.mset = function(obj, expiration, cb){
    if(arguments.length < 1){
      throw new Exception('INCORRECT_ARGUMENT_EXCEPTION', '.mset() requires a minimum of 1 argument.');
    }
    log(false, '.mset() called:', {data: obj});
    var multi = self.db.multi();
    for(var key in obj){
      if(obj.hasOwnProperty(key)){
        var tempExpiration = expiration || self.defaultExpiration;
        var value = obj[key];
        if(typeof value === 'object' && value.cacheValue){
          tempExpiration = value.expiration || tempExpiration;
          value = value.cacheValue;
        }
        try {
          value = self.JSON.stringify(value);
        } catch (err) {
          if(self.logJsonParseFailures) {
            log(true, 'Error converting to JSON, err:', err);
          }
        }
        multi.setex(prefixKey(key), tempExpiration, value);
      }
    }
    multi.exec(function (err, replies){
      if(cb) {
        cb(err, replies);
      }
    });
  };

  /**
   * Delete the provided keys and their associated values
   * @param {array} keys
   * @param {function} cb
   */
  self.del = function(keys, cb){
    if(arguments.length < 1){
      throw new Exception('INCORRECT_ARGUMENT_EXCEPTION', '.del() requires a minimum of 1 argument.');
    }
    if(keys === 'object') {
      keys = keys.map(prefixKey);
    }
    else {
      keys = prefixKey(keys);
    }
    log(false, '.del() called:', {keys: keys});
    try {
      self.db.del(keys, function (err, count){
        if(cb){
          cb(err, count);
        }
      });
      if(typeof keys === 'object'){
        for(var i = 0; i < keys.length; i++){
          var key = keys[i];
          delete refreshKeys[key];
        }
      }
      else{
        delete refreshKeys[keys];
      }
    } catch (err) {
      log(true, '.del() failed for cache of type ' + self.type, err);
    }
  };

  /**
   * Flush all keys and values from all configured caches in cacheCollection
   * @param {function} cb
   */
  self.flush = function(cb){
    log(false, '.flush() called');
    try {
      self.db.flushall();
      refreshKeys = {};
    } catch (err) {
      log(true, '.flush() failed for cache of type ' + self.type, err);
    }
    if(cb) {
      cb();
    }
  };

  /**
   ******************************************* PRIVATE FUNCTIONS *******************************************
   */

  /**
   * Initialize redisCacheModule given the provided constructor params
   */
  function init(){
    self.type = config.type || 'redis';
    if(config.redisMock){
      self.db = config.redisMock;
    }
    else{
      if(config.redisUrl){
        self.redisData = config.redisUrl || null;
      }
      else if(config.redisEnv){
        self.redisData = process.env[config.redisEnv] || null;
      }
      else if(config.redisData){
        self.redisData = config.redisData;
      }
      self.readOnly = (typeof config.readOnly === 'boolean') ? config.readOnly : false;
      try {
        if (self.redisData) {
          if(typeof self.redisData === 'string'){
            self.db = redis.createClient(self.redisData,
              {'no_ready_check': true,
              retry_strategy: retryStrategy});
          } else {
            self.db = redis.createClient(self.redisData.port,
              self.redisData.hostname, {'no_ready_check': true,
              retry_strategy: retryStrategy});

            // don't call redis auth method if no auth info passed
            if (self.redisData.auth) {
              self.db.auth(self.redisData.auth);
            }
          }
          self.db.on('error', function(err) {
            console.log('Error ' + err);
          });
          process.on('SIGTERM', function() {
            self.db.quit();
          });
          log(false, 'Redis client created with the following defaults:', {expiration: self.defaultExpiration, verbose: self.verbose, readOnly: self.readOnly});
        } else {
          self.db = false;
          log(false, 'Redis client not created: no redis config provided');
        }
      } catch (err) {
        self.db = false;
        log(true, 'Redis client not created:', err);
      }
    }
  }

  init();
}

module.exports = redisCacheModule;
redisCacheModule._retryStrategy = retryStrategy;
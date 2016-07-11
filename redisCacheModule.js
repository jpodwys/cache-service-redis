var redis = require('redis');

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
  var refreshKeys = {};
  var backgroundRefreshEnabled = false;

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
      throw new exception('INCORRECT_ARGUMENT_EXCEPTION', '.get() requires 2 arguments.');
    }
    log(false, 'get() called:', {key: key});
    try {
      var cacheKey = (cleanKey) ? cleanKey : key;
      log(false, 'Attempting to get key:', {key: cacheKey});
      self.db.get(cacheKey, function(err, result){
        try {
          result = JSON.parse(result);
        } catch (err) {
          //Do nothing
        }
        cb(err, result);
      });
    } catch (err) {
      cb({name: 'GetException', message: err}, null);
    }
  }

  /**
   * Get multiple values given multiple keys
   * @param {array} keys
   * @param {function} cb
   * @param {integer} index
   */
  self.mget = function(keys, cb, index){
    if(arguments.length < 2){
      throw new exception('INCORRECT_ARGUMENT_EXCEPTION', '.mget() requires 2 arguments.');
    }
    log(false, '.mget() called:', {keys: keys});
    self.db.mget(keys, function (err, response){
      var obj = {};
      for(var i = 0; i < response.length; i++){
        if(response[i] !== null){
          try {
            response[i] = JSON.parse(response[i]);
          } catch (err) {
            //Do nothing
          }
          obj[keys[i]] = response[i];
        }
      }
      cb(err, obj, index);
    });
  }

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
      throw new exception('INCORRECT_ARGUMENT_EXCEPTION', '.set() requires a minimum of 2 arguments.');
    }
    var key = arguments[0];
    var value = arguments[1];
    var expiration = arguments[2] || null;
    var refresh = (arguments.length == 5) ? arguments[3] : null;
    var cb = (arguments.length == 5) ? arguments[4] : arguments[3];
    cb = cb || noop;
    log(false, '.set() called:', {key: key, value: value});
    try {
      if(!self.readOnly){
        expiration = expiration || self.defaultExpiration;
        var exp = (expiration * 1000) + Date.now();
        if(typeof value === 'object'){
          try {
            value = JSON.stringify(value);
          } catch (err) {
            //Do nothing
          }
        }
        if(refresh){
          self.db.set(key, value, 'nx', 'ex', expiration, function (err, response){

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
          self.db.setex(key, expiration, value, cb);
        }
      }
    }catch (err) {
      log(true, '.set() failed for cache of type ' + self.type, {name: 'RedisSetException', message: err});
    }
  }

  /**
   * Associate multiple keys with multiple values and optionally set expirations per function and/or key
   * @param {object} obj
   * @param {integer} expiration
   * @param {function} cb
   */
  self.mset = function(obj, expiration, cb){
    if(arguments.length < 1){
      throw new exception('INCORRECT_ARGUMENT_EXCEPTION', '.mset() requires a minimum of 1 argument.');
    }
    log(false, '.mset() called:', {data: obj});
    var multi = self.db.multi();
    for(key in obj){
      if(obj.hasOwnProperty(key)){
        var tempExpiration = expiration || self.defaultExpiration;
        var value = obj[key];
        if(typeof value === 'object' && value.cacheValue){
          tempExpiration = value.expiration || tempExpiration;
          value = value.cacheValue;
        }
        try {
          value = JSON.stringify(value);
        } catch (err) {
          //Do nothing
        }
        multi.setex(key, tempExpiration, value);
      }
    }
    multi.exec(function (err, replies){
      if(cb) cb(err, replies);
    });
  }

  /**
   * Delete the provided keys and their associated values
   * @param {array} keys
   * @param {function} cb
   */
  self.del = function(keys, cb){
    if(arguments.length < 1){
      throw new exception('INCORRECT_ARGUMENT_EXCEPTION', '.del() requires a minimum of 1 argument.');
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
  }

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
    if(cb) cb();
  }

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
        self.redisData = config.redisData
      }
      self.readOnly = (typeof config.readOnly === 'boolean') ? config.readOnly : false;
      try {
        if (self.redisData) {
          if(typeof self.redisData === 'string'){
            var redisURL = require('url').parse(self.redisData);
            self.db = redis.createClient(redisURL.port, redisURL.hostname, {no_ready_check: true, max_attempts: 5});
            if (redisURL.auth !== null) self.db.auth(redisURL.auth.split(":")[1]);
          }
          else{
            self.db = redis.createClient(self.redisData.port, self.redisData.hostname, {no_ready_check: true, max_attempts: 5});
            self.db.auth(self.redisData.auth);
          }
          self.db.on('error', function(err) {
            console.log("Error " + err);
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

  /**
   * Initialize background refresh
   */
  function backgroundRefreshInit(){
    if(!backgroundRefreshEnabled){
      backgroundRefreshEnabled = true;
      if(self.backgroundRefreshIntervalCheck){
        if(self.backgroundRefreshInterval > self.backgroundRefreshMinTtl){
          throw new exception('BACKGROUND_REFRESH_INTERVAL_EXCEPTION', 'backgroundRefreshInterval cannot be greater than backgroundRefreshMinTtl.');
        }
      }
      setInterval(function(){
        backgroundRefresh();
      }, self.backgroundRefreshInterval);
    }
  }

  /**
   * Refreshes all keys that were set with a refresh function
   */
  function backgroundRefresh(){
    for(key in refreshKeys){
      if(refreshKeys.hasOwnProperty(key)){
        var data = refreshKeys[key];
        if(data.expiration - Date.now() < self.backgroundRefreshMinTtl){
          data.refresh(key, function (err, response){
            if(!err){
              self.set(key, response, data.lifeSpan, data.refresh, noop);
            }
          });
        }
      }
    }
  }

  /**
   * Instantates an exception to be thrown
   * @param {string} name
   * @param {string} message
   * @return {exception}
   */
  function exception(name, message){
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
      if(data) console.log(indentifier + message, data);
      else console.log(indentifier + message);
    }
  }

  var noop = function(){}

  init();
}

module.exports = redisCacheModule;

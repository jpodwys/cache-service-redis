var expect = require('expect');
var redisMock = require('redis-js');
var rcModule = require('../../redisCacheModule');
var redisCache = new rcModule({
  redisMock: redisMock,
  backgroundRefreshInterval: 500,
  nameSpace: 'test'
});

var key = 'key';
var value = 'value';

function noop() {}

beforeEach(function(){
  redisCache.flush();
});

describe('redisCacheModule Tests', function () {
  it('Getting absent key should return null', function (done) {
    redisCache.get(key, function (err, result){
      expect(result).toBe(null);
      done();
    });
  });
  it('Setting then getting key should return value', function (done) {
    redisCache.set(key, value);
    redisCache.get(key, function (err, result) {
      expect(result).toBe(value);
    });
    redisCache.db.get(`test:${key}`, function (err, result) {
      expect(result).toBe(value);
      done();
    });
  });
  it('Setting then deleting then getting key should return null', function (done) {
    redisCache.set(key, value);
    redisCache.del(key);
    redisCache.get(key, function (err, result) {
      expect(result).toBe(null);
    });
    redisCache.db.get(`test:${key}`, function (err, result) {
      expect(result).toBe(null);
      done();
    });
  });
  it('Setting several keys then calling .flush() should remove all keys', function (done) {
    redisCache.set(key, value);
    redisCache.set('key2', 'value2');
    redisCache.set('key3', 'value3');
    redisCache.db.keys('*', function (err, keys){
      var keyCount = keys.length;
      expect(keyCount).toBe(3);
      for(var key of keys) {
        expect(key).toMatch(/^test:key[2-3]?$/);
      }
      redisCache.flush();
      redisCache.db.keys('*', function (err, keys){
        keyCount = keys.length;
        expect(keyCount).toBe(0);
        done();
      });
    });
  });
  it('Setting several keys then calling .mget() should retrieve all keys', function (done) {
    redisCache.set(key, value);
    redisCache.set('key2', 'value2');
    redisCache.set('key3', 'value3');
    redisCache.mget([key, 'key2', 'key3', 'key4'], function (err, response){
      expect(response.key).toBe('value');
      expect(response.key2).toBe('value2');
      expect(response.key3).toBe('value3');
      expect(response.key4).toBe(undefined);
      done();
    });
  });
  it('Setting several keys via .mset() then calling .mget() should retrieve all keys', function (done) {
    redisCache.mset({key: value, 'key2': 'value2', 'key3': 'value3'}, null, function (err, replies){
      redisCache.mget([key, 'key2', 'key3', 'key4'], function (err, response){
        expect(response.key).toBe('value');
        expect(response.key2).toBe('value2');
        expect(response.key3).toBe('value3');
        expect(response.key4).toBe(undefined);
      });
    });
    redisCache.db.keys('*', function (err, keys) {
      var keyCount = keys.length;
      expect(keyCount).toBe(3);
      for (var key of keys) {
        expect(key).toMatch(/^test:key[2-3]?$/);
      }
      done();
    });
  });
  it('Using background refresh should not activate for a key that already exists', function (done) {
    this.timeout(5000);
    var refresh = function(key, cb){
      cb(null, 1);
    }
    redisCache.set(key, value, 1, function (){
      redisCache.set(key, value, 1, refresh, function (err, result){
        setTimeout(function(){
          redisCache.get(key, function (err, response){
            expect(response).toBe(null);
            done();
          });
        }, 1500);
      });
    });
  });
  it('Using background refresh should activate for a vacant key and reset it when nearly expired', function (done) {
    this.timeout(5000);
    var refresh = function(key, cb){
      cb(null, 1);
    }
    redisCache.set(key, value, 1, refresh, function (err, result){
      setTimeout(function(){
        redisCache.get(key, function (err, response){
          expect(response).toBe(1);
          done();
        });
      }, 1500);
    });
  });
  it('Using background refresh should work for multiple keys', function (done) {
    function noop() {}
    this.timeout(5000);
    var refresh = function(key, cb){
      switch(key) {
        case 'one':
          setTimeout(function() {
            cb(null, 1);
          }, 100);
          break;
        case 'two':
          setTimeout(function() {
            cb(null, 2);
          }, 100);
          break;
      }
    };

    redisCache.set('one', value, 1, refresh, noop);
    redisCache.set('two', value, 1, refresh, noop);

    setTimeout(function() {
      var results = [];
      function examineResults() {
        results.forEach(function(result) {
          if (result.key === 'one') {
            expect(result.response).toBe(1);
          } else {
            expect(result.response).toBe(2);
          }
        });

        done();
      }
      redisCache.get('one', function (err, response){
        results.push({key: 'one', response: response});
        if (results.length === 2) {
          examineResults();
        }
      });
      redisCache.get('two', function (err, response){
        results.push({key: 'two', response: response});
        if (results.length === 2) {
          examineResults();
        }
      });

    }, 1500);
  });
  it('Using custom JSON interface should parse JSON to custom object', function (done) {
    this.timeout(5000);

    redisCache.logJsonParseFailures = true;
    redisCache.JSON.parse = function (text) {
      const obj = JSON.parse(text);
      if (obj.type === 'Buffer') {
        return Buffer.from(obj);
      } else {
        return obj;
      }
    };

    const buffer = Buffer.from([0x00, 0x61, 0x00, 0x62, 0x00, 0x63])
    redisCache.set('bffr', buffer);
    redisCache.get('bffr', function (err, response) {
      expect(response).toEqual(buffer);
      done();
    });
  });
  it('should retry connecting when retries is less than 5 times', function() {
    var mockOptions = {
      attempt: 5,
      total_retry_time: 1000,
      times_connected: 0 };
    expect(rcModule._retryStrategy(mockOptions)).toExist()
  });

  it('should retry connecting when retries is more than 5 times', function() {
    var mockOptions = {
      attempt: 6,
      total_retry_time: 1000,
      times_connected: 0 };
    expect(rcModule._retryStrategy(mockOptions)).toNotExist()
  });
});

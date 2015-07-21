var expect = require('expect');
var redisMock = require('redis-js');
var rcModule = require('../../redisCacheModule');
var redisCache = new rcModule({
  redisMock: redisMock,
  backgroundRefreshEnabled: true,
  backgroundRefreshInterval: 500
});

var key = 'key';
var value = 'value';

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
      done();
    });
  });
  it('Setting then deleting then getting key should return null', function (done) {
    redisCache.set(key, value);
    redisCache.del(key);
    redisCache.get(key, function (err, result) {
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
        done();
      });
    });
  });
  it('Using background refresh should not activate for a key that already exists', function (done) {
    this.timeout(5000);
    var refresh = function(cb){
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
    var refresh = function(cb){
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
});

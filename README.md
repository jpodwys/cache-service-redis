# cache-service-redis

* A [redis](https://github.com/mranney/node_redis) plugin for [cache-service](https://github.com/jpodwys/cache-service)
* AND a standalone redis wrapper

#### Features

* Background refresh
* Cache objects--automatic serialization/deserialization of values
* Easy config handling--pass the name of an ENV OR the `redis` connection config string OR all `redis` connection params
* Robust API
* Built-in logging with a `verbose` flag.
* Compatible with `cache-service` and `superagent-cache`
* Public access to the underlying `node_redis` instance
* A more logical API--`.mset()` takes an object of keys and values rather than a comma-separated argument list
* `.mset()` allows you to set expirations on a per key, per function call, and/or per `cache-service-redis` instance basis (Vanilla `redis` does not let `.mset()` set expirations at all)
* Built-in [redis mock support](#using-a-redis-mock) for local testing

# Basic Usage

Require and instantiate
```javascript
var csRedis = require('cache-service-redis');

var cacheModuleConfig = {redisEnv: 'REDISCLOUD_URL'};
var redisCache = new csRedis(cacheModuleConfig);
```

Cache!
```javascript
redisCache.set('key', 'value');
```

# Cache Module Configuration Options

`cache-service-redis`'s constructor takes an optional config object with any number of the following properties:

## type

An arbitrary identifier you can assign so you know which cache is responsible for logs and errors.

* type: string
* default: 'redis'

## defaultExpiration

The expiration to include when executing cache set commands. Can be overridden via `.set()`'s optional expiraiton param.

* type: int
* default: 900
* measure: seconds

## redisData

This is the most generic way to pass in your redis configuraiton options.

* type: object

#### Example

```javascript
var redisData = {
  port: myRedisPort,
  hostname: myRedisHostname,
  auth: myRedisAuth
}
```

## redisUrl

If you have all of your redis params already prepared as a URL in the following format: `http://uri:password@hostname:port`, then you can simply pass that URL with the object key `redisUrl`.

* type: string

## redisEnv

If you have a redis URL contained in an env variable (in process.env[redisEnv]), cache-service can retrieve it for you if you pass the env variable name with the object key `redisEnv`.

* type: string

## redisMock

If you want to test your `cache-service-redis` implementation, you can pass a redis mock with this key and `cache-service-redis` will consume it for testing purposes. See the [Using A Redis Mock](#using-a-redis-mock) section for a more throrough explanation.

* type: object that mocks redis

## backgroundRefreshInterval

How frequently should all background refresh-enabled keys be scanned to determine whether they should be refreshed. For a more thorough explanation on `background refresh`, see the [Using Background Refresh](#using-background-refresh) section.

* type: int
* default: 60000
* measure: milliseconds

## backgroundRefreshMinTtl

The maximum ttl a scanned background refresh-enabled key can have without triggering a refresh. This number should always be greater than `backgroundRefreshInterval`.

* type: int
* default: 70000
* measure: milliseconds

## backgroundRefreshIntervalCheck

Whether to throw an exception if `backgroundRefreshInterval` is greater than `backgroundRefreshMinTtl`. Setting this property to false is highly discouraged.

* type: boolean
* default: true

## verbose

> When used with `cache-service`, this property is overridden by `cache-service`'s `verbose` value.

When false, `cache-service-redis` will log only errors. When true, `cache-service-redis` will log all activity (useful for testing and debugging).

* type: boolean
* default: false

# API

Although this is a redis wrapper, its API differs in some small cases from redis's own API both because the redis API is sometimes dumb and because all `cache-service`-compatible cache modules match [`cache-service`'s API](https://github.com/jpodwys/cache-service#api).

## .get(key, callback (err, response))

Retrieve a value by a given key.

* key: type: string
* callback: type: function
* err: type: object
* response: type: string or object

## .mget(keys, callback (err, response))

Retrieve the values belonging to a series of keys. If a key is not found, it will not be in `response`.

* keys: type: an array of strings
* callback: type: function
* err: type: object
* response: type: object, example: {key: 'value', key2: 'value2'...}

## .set(key, value, [expiraiton], [refresh(key, cb)], [callback])

> See the [Using Background Refresh](#using-background-refresh) section for more about the `refresh` and `callback` params.

Set a value by a given key.

* key: type: string
* callback: type: function
* expiration: type: int, measure: seconds
* refresh: type: function
* callback: type: function

## .mset(obj, [expiration], [callback])

Set multiple values to multiple keys

* obj: type: object, example: {'key': 'value', 'key2': 'value2', 'key3': {cacheValue: 'value3', expiration: 60}}
* callback: type: function

This function exposes a heirarchy of expiration values as follows:
* The `expiration` property of a key that also contains a `cacheValue` property will override all other expirations. (This means that, if you are caching an object, the string 'cacheValue' is a reserved property name within that object.)
* If an object with both `cacheValue` and `expiration` as properties is not present, the `expiration` provided to the `.mset()` argument list will be used.
* If neither of the above is provided, each cache's `defaultExpiration` will be applied.

## .del(keys, [callback (err, count)])

Delete a key or an array of keys and their associated values.

* keys: type: string || array of strings
* callback: type: function
* err: type: object
* count: type: int

## .flush([cb])

Flush all keys and values.

* callback: type: function

## .db

This is the underlying [`node_redis` instance](https://github.com/mranney/node_redis). If needed, you can access `redis` functions I haven't abstracted.

# Using Background Refresh

With a typical cache setup, you're left to find the perfect compromise between having a long expiration so that users don't have to suffer through the worst case load time, and a short expiration so data doesn't get stale. `cache-service-redis` eliminates the need to worry about users suffering through the longest wait time by automatically refreshing keys for you. Here's how it works:

> `cache-service-redis` employs an intelligent background refresh algorithm that makes it so only one dyno executes a background refresh for any given key. You should feel confident that you will not encounter multiple dynos refreshing a single key.

#### How do I turn it on?

By default, background refresh is off. It will turn itself on the first time you pass a `refresh` param to `.set()`.

#### Configure

There are three options you can manipulate. See the API section for more information about them.

* `backgroundRefreshInterval`
* `backgroundRefreshMinTtl`
* `backgroundRefreshIntervalCheck`

#### Use

Background refresh is exposed via the `.set()` command as follows:

```javascript
cacheModule.set('key', 'value', 300, refresh, cb);
```

If you want to pass `refresh`, you must also pass `cb` because if only four params are passed, `cache-service-redis` will assume the fourth param is `cb`.

#### The Refresh Param

###### refresh(key, cb(err, response))

* key: type: string: this is the key that is being refreshed
* cb: type: function: you must trigger this function to pass the data that should replace the current key's value

The `refresh` param MUST be a function that accepts `key` and a callback function that accepts `err` and `response` as follows:

```javascript
var refresh = function(key, cb){
  var response = goGetData();
  cb(null, response);
}
```

# Using A Redis Mock

You're likely to want to test your implementation of `cache-service-redis`. In order to write tests that will run anywhere, you'll need to use a redis mock. I recommend using [redis-js](https://www.npmjs.com/package/redis-js). `cache-service-redis` natively supports mock usage as follows:

```javascript
var redisMock = require('redis-js');
var rcModule = require('cache-service-redis');
var redisCache = new rcModule({
  redisMock: redisMock,
  backgroundRefreshInterval: 500
});
```

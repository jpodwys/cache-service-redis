# cache-service-redis

A redis plugin for cache-service, or a standalone redis wrapper.

# Cache Module Configuration Options

## redisData (only for use with `type` 'redis')

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

## redisUrl (only for use with `type` 'redis')

If you have all of your redis params already prepared as a URL in the following format: `http://uri:password@hostname:port`, then you can simply pass that URL with the object key `redisUrl`.

* type: string

## redisEnv (only for use with `type` 'redis')

If you have a redis URL contained in an env variable (in process.env[redisEnv]), cache-service can retrieve it for you if you pass the env variable name with the object key `redisEnv`.

* type: string

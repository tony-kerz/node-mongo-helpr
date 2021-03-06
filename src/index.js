import assert from 'assert'
import mongodb from 'mongodb'
import debug from 'debug'
import _ from 'lodash'
import config from 'config'
import {stringify, isHex, debugElements, UNIQUENESS_ERROR, join} from 'helpr'

const dbg = debug('app:mongo-helpr')

export const SEQUENCES_NAME = _.get(config, 'mongo.sequences', 'sequences')

const oidLength = 24
const logLevel = _.get(config, 'mongo.logger.level')
if (logLevel) {
  mongodb.Logger.setLevel(logLevel)
  const filterClasses = _.get(config, 'mongo.logger.filterClasses')
  filterClasses && mongodb.Logger.filter('class', filterClasses)
}

function setOption({options, config, key, option, hook = _.identity}) {
  const value = _.get(config, key)
  if (value) {
    options[option] = hook(value)
  }
}

export const options = {}
setOption({config, options, key: 'mongo.connectTimeoutMs', option: 'connectTimeoutMS', hook: parseInt})
setOption({config, options, key: 'mongo.socketTimeoutMs', option: 'socketTimeoutMS', hook: parseInt})
setOption({config, options, key: 'mongo.poolSize', option: 'poolSize', hook: parseInt})
setOption({config, options, key: 'mongo.replicaSet', option: 'replicaSet'})

const client = mongodb.MongoClient
var _mongoHelpr = {} // singleton, see: http://stackoverflow.com/a/14464750/2371903

export function getConnectionString() {
  const host = config.get('mongo.host')
  const dbName = config.get('mongo.db')
  dbg('get-connection-string: connect: host=%o, db=%o, options=%o', host, dbName, options)
  return `mongodb://${host}/${dbName}`
}

export async function getDb({init} = {}) {
  init && await closeDb()

  if (!_mongoHelpr.db) {
    _mongoHelpr.db = await client.connect(getConnectionString(), options)
  }

  return _mongoHelpr.db
}

export async function closeDb() {
  if (_mongoHelpr.db) {
    const db = _mongoHelpr.db
    await _mongoHelpr.db.close()
    _mongoHelpr.db = null
    dbg('close-db: closed db=%o', db.databaseName)
  }
}

export function dbName() {
  return config.get('mongo.db')
}

export function parseParam(value) {
  if (_.isString(value) && value.startsWith('/')) {
    const toks = value.split('/').filter(value => {
      return value !== ''
    })
    assert(toks[0])
    return {$regex: toks[0], $options: toks[1] || ''}
  }
  return value
}

export function oid(value, {strict} = {}) {
  const isValid = value ? isValidOid(value) : true
  if (strict && !isValid) {
    throw new Error(`unable to create oid from value=${value}`)
  }
  let result
  if (value) {
    if ((value.length <= oidLength) && (isHex(value))) {
      result = new mongodb.ObjectID(value.padStart(oidLength, '0'))
    } else {
      result = value
    }
  } else {
    result = new mongodb.ObjectID()
  }
  return result
}

export function isValidOid(value) {
  return ((value.length === oidLength) && isHex(value))
}

export async function findOne({db, query, steps, collectionName, isRequired}) {
  const _db = db || await getDb()
  const collection = _db.collection(collectionName)
  const cursor = steps ? collection.aggregate(steps, {allowDiskUse: true}) : collection.find(query)
  const result = await cursor.toArray()
  if (result.length > 1) {
    throw new Error(`unexpected multiple hits, query=${stringify(steps || query)}, collection=${collectionName}`)
  }
  if (isRequired && result.length !== 1) {
    throw new Error(`record required, query=${stringify(steps || query)}, collection=${collectionName}`)
  }
  return (result.length === 1) ? result[0] : null
}

export async function requireOne(opts) {
  return await findOne({...opts, isRequired: true})
}

export async function getCount({db, query, steps = [], collectionName}) {
  const _db = db || await getDb()
  const collection = _db.collection(collectionName)
  const cursor = collection.aggregate(
    steps.concat(
      [
        {$match: query},
        {$group: {_id: null, count: {$sum: 1}}}
      ]
    ),
    {allowDiskUse: true}
  )
  const result = await cursor.toArray()
  dbg('count: result=%o', result)
  return (result.length === 1) ? result[0].count : 0
}

export async function assertNone({db, query, steps = [], collectionName}) {
  const count = await getCount({db, query, steps, collectionName})
  if (count !== 0) {
    const e = new Error(`record already exists in [${collectionName}] for ${stringify(query)}`)
    e.name = UNIQUENESS_ERROR
    throw e
  }
  return true
}

export async function getNextSequence(entity, {db} = {}) {
  assert(entity, 'entity required')
  const _db = db || await getDb()
  const result = await _db.collection(SEQUENCES_NAME).findOneAndUpdate(
    {_id: entity},
    {$inc: {sequence: 1}},
    {
      upsert: true,
      returnOriginal: false
    }
  )
  assert(result.ok, `unexpected result=${stringify(result)}`)
  return result.value.sequence
}

export async function createIndices({indices, db, collectionName, isDrop}) {
  assert(indices, 'indices required')
  const _db = db || await getDb()
  const target = _db.collection(collectionName)
  if (isDrop) {
    try {
      const result = await target.dropIndexes()
      assert(result.ok, 'ok result required')
      dbg('dropped indices for collection=%o', collectionName)
    } catch (err) {
      if (err.code === 26) {
        // collection doesn't exist code
        dbg('attempted to drop indices for non-existent collection=%o, continuing...', collectionName)
      } else {
        throw err
      }
    }
  }
  await Promise.all(indices.map(index => {
    return Array.isArray(index) ? target.createIndex(...index) : target.createIndex(index)
  }))
  debugElements({dbg, msg: `create-indices: collection=${collectionName}, indices`, o: indices})
  return true
}

export async function createValidator({validator, db, collectionName}) {
  assert(validator, 'validator required')
  const _db = db || await getDb()
  const collection = await _db.createCollection(collectionName, {w: 1})
  assert(collection, 'collection required')
  await _db.command({collMod: collectionName, validator})
  debugElements({dbg, msg: `create-validator: collection=${collectionName}, validator`, o: validator})
}

export function existsIndex(...fields) {
  return [
    _.transform(fields, (result, field) => {
      result[field] = 1
    }, {}),
    {
      unique: true,
      partialFilterExpression: _.transform(fields, (result, field) => {
        result[field] = {$exists: true}
      }, {})
    }
  ]
}

export function unwind(path, {preserveEmpty} = {}) {
  const preserveNullAndEmptyArrays = _.isBoolean(preserveEmpty) ? preserveEmpty : true
  return {$unwind: {path, preserveNullAndEmptyArrays}}
}

export function ifNull({test, is, not}) {
  return {
    $cond: [
      // https://jira.mongodb.org/browse/SERVER-26180?focusedCommentId=1394961&page=com.atlassian.jira.plugin.system.issuetabpanels:comment-tabpanel#comment-1394961
      {$eq: [{$ifNull: [test, null]}, null]},
      is,
      not
    ]
  }
}

export function ensureAnd(query) {
  if (!query.$and) {
    return {...query, $and: []}
  }
  return query
}

export function pushOrs({query, ors}) {
  if (query.$or) {
    const _query = ensureAnd(query)
    _query.$and.push({$or: ors})
    return _query
  }
  return {...query, $or: ors}
}

export function toDotNotation({target, path = [], result = {}}) {
  return _.reduce(
    target,
    (result, val, key) => {
      if (_.isPlainObject(val)) {
        return toDotNotation({target: val, path: path.concat([key]), result})
      }
      result[join(path.concat([key]))] = val
      return result
    },
    result
  )
}

export function sanitizeKeys(data) {
  return _.isPlainObject(data) ?
    _.transform(
      data,
      (result, val, key) => {
        const _key = key.startsWith('$') ? key.replace('$', '_$') : key
        result[_key.replace(/\./g, '_')] = sanitizeKeys(val)
      }
    ) :
    data
}

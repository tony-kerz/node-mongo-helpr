import assert from 'assert'
import mongodb from 'mongodb'
import debug from 'debug'
import _ from 'lodash'
import config from 'config'
import {stringify, isHex, debugElements, VALIDATION_ERROR} from 'helpr'

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

const options = {}
setOption({config, options, key: 'mongo.connectTimeoutMs', option: 'connectTimeoutMS', hook: parseInt})
setOption({config, options, key: 'mongo.socketTimeoutMs', option: 'socketTimeoutMS', hook: parseInt})
setOption({config, options, key: 'mongo.poolSize', option: 'poolSize', hook: parseInt})

const client = mongodb.MongoClient
let __db // singleton, see: http://stackoverflow.com/a/14464750/2371903

export async function getDb({init} = {}) {
  const host = config.get('mongo.host')
  const port = config.get('mongo.port')
  const dbName = config.get('mongo.db')

  init && await closeDb()

  if (!__db) {
    dbg('get-db: connect: host=%o, port=%o, db=%o, options=%o', host, port, dbName, options)
    __db = await client.connect(`mongodb://${host}:${port}/${dbName}`, options)
  }

  return __db
}

export async function closeDb() {
  if (__db) {
    const db = __db
    await __db.close()
    __db = null
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

export function requireOne(opts) {
  return findOne({...opts, isRequired: true})
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
    e.name = VALIDATION_ERROR
    throw e
  }
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

export async function createIndices({indices, db, collectionName}) {
  assert(indices, 'indices required')
  const _db = db || await getDb()
  const target = _db.collection(collectionName)
  await Promise.all(indices.map(index => {
    return Array.isArray(index) ? target.createIndex(...index) : target.createIndex(index)
  }))
  debugElements({dbg, msg: `create-indices: collection=${collectionName}, indices`, o: indices})
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

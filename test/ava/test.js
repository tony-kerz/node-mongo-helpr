import test from 'ava'
import debug from 'debug'
import mongodb from 'mongodb'
import {assertAutomatedTest, initDb} from 'mongo-test-helpr'
import {
  parseParam,
  oid,
  getNextSequence,
  existsIndex,
  getDb,
  closeDb,
  SEQUENCES_NAME,
  ifNull,
  createIndices,
  createValidator
} from '../../src'

/* eslint-disable new-cap */
const dbg = debug('test:mongo-helpr')

test('getDb: basic', async t => {
  const db1 = await getDb()
  t.truthy(db1)
  const db2 = await getDb()
  t.truthy(db2)
  t.is(db1, db2)
})

test('getDb: init', async t => {
  const db1 = await getDb()
  t.truthy(db1)
  const db2 = await getDb({init: true})
  t.truthy(db2)
  t.not(db1, db2)
})

test('closeDb', async t => {
  const db1 = await getDb()
  t.truthy(db1)
  await closeDb()
  const db2 = await getDb()
  t.truthy(db2)
  t.not(db1, db2)
})

test('parseParam: null', async t => {
  t.is(parseParam(null), null)
})

test('parseParam: string', async t => {
  t.is(parseParam('foo'), 'foo')
})

test('parseParam: regex', async t => {
  t.deepEqual(parseParam('/foo'), {$regex: 'foo', $options: ''})
})

test('parseParam: regex with option', async t => {
  t.deepEqual(parseParam('/foo/i'), {$regex: 'foo', $options: 'i'})
})

test('oid', async t => {
  t.truthy(oid() instanceof mongodb.ObjectId)
})

test('oid: valid value', async t => {
  const value = '012345678901234567890123'
  t.is(oid(value).toHexString(), mongodb.ObjectId(value).toHexString())
})

test('oid: invalid value lax', async t => {
  t.is(oid('1').toHexString(), mongodb.ObjectId('000000000000000000000001').toHexString())
})

test('oid: invalid value strict', async t => {
  t.throws(() => {
    oid('1', {strict: true})
  })
})

test('getNextSequence', async t => {
  const db = await getDb()
  t.truthy(db)
  assertAutomatedTest(db)
  try {
    const result = await db.dropCollection(SEQUENCES_NAME)
    t.truthy(result)
  } catch (err) {
    dbg('get-next-sequence: message=%o, (assuming allowable)', err.message)
    err.code && t.is(err.code, 26) // collection doesn't exist code
  }
  t.is(await getNextSequence('stuff', {db}), 1)
  t.is(await getNextSequence('stuff', {db}), 2)
  t.is(await getNextSequence('stuff', {db}), 3)
})

test('existsIndex', async t => {
  t.deepEqual(
    existsIndex('foo'),
    [
      {foo: 1},
      {unique: true, partialFilterExpression: {foo: {$exists: true}}}
    ]
  )
  t.deepEqual(
    existsIndex('foo', 'bar'),
    [
      {foo: 1, bar: 1},
      {unique: true, partialFilterExpression: {foo: {$exists: true}, bar: {$exists: true}}}
    ]
  )
})

test('ifNull', async t => {
  t.deepEqual(
    ifNull(
      {
        test: '$foo',
        is: '$bar',
        not: '$baz'
      }
    ),
    {
      $cond: [
        {$eq: [{$ifNull: ['$foo', null]}, null]},
        '$bar',
        '$baz'
      ]
    }
  )
})

test('createIndices', async t => {
  const db = await getDb()
  await initDb(db)
  const collectionName = 'indexed'
  await createIndices(
    {
      db,
      collectionName,
      indices: [
        [{name: 1}, {unique: true}],
        {age: 1}
      ]
    }
  )
  const result = await db.collection(collectionName).save({name: 'foo'})
  t.is(result.result.n, 1)

  await t.throws(db.collection(collectionName).save({name: 'foo'}))
})

test('createValidator', async t => {
  const db = await getDb()
  await initDb(db)
  const collectionName = 'validated'
  await createValidator(
    {
      db,
      collectionName,
      validator: {name: {$type: 'string'}}
    }
  )
  const result = await db.collection(collectionName).save({name: 'foo'})
  t.is(result.result.n, 1)

  await t.throws(db.collection(collectionName).save({name: 1}))
})

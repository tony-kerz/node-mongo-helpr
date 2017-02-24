import test from 'ava'

import {
  insureAnd,
  pushOrs
} from '../../src'

test('getAnd', t => {
  t.deepEqual(insureAnd({}).$and, [])
  t.deepEqual(insureAnd({$and: ['foo']}).$and, ['foo'])
})

test('pushOrs', t => {
  let query = {}

  query = pushOrs({query, ors: [{foo: 'bar'}]})
  t.deepEqual(
    query,
    {
      $or: [
        {foo: 'bar'}
      ]
    }
  )

  query = pushOrs({query, ors: [{baz: 'bip'}]})
  t.deepEqual(
    query,
    {
      $or: [
        {foo: 'bar'}
      ],
      $and: [
        {
          $or: [
            {baz: 'bip'}
          ]
        }
      ]
    }
  )

  query = pushOrs({query, ors: [{fee: 'fie'}]})
  t.deepEqual(
    query,
    {
      $or: [
        {foo: 'bar'}
      ],
      $and: [
        {
          $or: [
            {baz: 'bip'}
          ]
        },
        {
          $or: [
            {fee: 'fie'}
          ]
        }
      ]
    }
  )
})

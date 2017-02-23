import test from 'ava'

import {
  getAnd,
  pushOrs
} from '../../src'

test('getAnd', t => {
  t.deepEqual(getAnd({}), [])
  t.deepEqual(getAnd({$and: ['foo']}), ['foo'])
})

test('pushOrs', t => {
  const query = {}

  pushOrs({query, ors: [{foo: 'bar'}]})
  t.deepEqual(
    query,
    {
      $or: [
        {foo: 'bar'}
      ]
    }
  )

  pushOrs({query, ors: [{baz: 'bip'}]})
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

  pushOrs({query, ors: [{fee: 'fie'}]})
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

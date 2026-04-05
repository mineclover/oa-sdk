import { describe, it, expect } from 'vitest'
import { defaultNaming } from '../../drizzle/naming.js'

describe('defaultNaming', () => {
  describe('select', () => {
    it('users → User', () => expect(defaultNaming.select('users')).toBe('User'))
    it('posts → Post', () => expect(defaultNaming.select('posts')).toBe('Post'))
    it('단수형 유지: user → User', () => expect(defaultNaming.select('user')).toBe('User'))
  })

  describe('insert', () => {
    it('users → InsertUser', () => expect(defaultNaming.insert('users')).toBe('InsertUser'))
  })

  describe('update', () => {
    it('users → UpdateUser', () => expect(defaultNaming.update('users')).toBe('UpdateUser'))
  })

  describe('singularize — 기본 규칙', () => {
    it('trailing s 제거: posts → Post', () => expect(defaultNaming.select('posts')).toBe('Post'))
    it('ss 유지: address → Address', () => expect(defaultNaming.select('address')).toBe('Address'))
    it('us 유지: status → Status', () => expect(defaultNaming.select('status')).toBe('Status'))
    it('is 유지: analysis → Analysis', () => expect(defaultNaming.select('analysis')).toBe('Analysis'))
  })

  describe('singularize — 특수 규칙', () => {
    it('ies → y: categories → Category', () => expect(defaultNaming.select('categories')).toBe('Category'))
    it('sses → ss: addresses → Address', () => expect(defaultNaming.select('addresses')).toBe('Address'))
    it('ves → f: leaves → Leaf', () => expect(defaultNaming.select('leaves')).toBe('Leaf'))
  })

  describe('singularize — snake_case 마지막 세그먼트에만 적용', () => {
    it('order_items → OrderItem', () => expect(defaultNaming.select('order_items')).toBe('OrderItem'))
    it('blog_posts → BlogPost', () => expect(defaultNaming.select('blog_posts')).toBe('BlogPost'))
    it('blog_categories → BlogCategory', () => expect(defaultNaming.select('blog_categories')).toBe('BlogCategory'))
    it('user_addresses → UserAddress', () => expect(defaultNaming.select('user_addresses')).toBe('UserAddress'))
    it('order_statuses → OrderStatus (마지막 세그먼트만 singularize)', () => {
      // 이전 버그: order_statuses → order_statu → OrderStatu (잘못됨)
      expect(defaultNaming.select('order_statuses')).toBe('OrderStatus')
    })
  })

  describe('PascalCase 변환', () => {
    it('단일 단어: users → User', () => expect(defaultNaming.select('users')).toBe('User'))
    it('두 단어: blog_posts → BlogPost', () => expect(defaultNaming.select('blog_posts')).toBe('BlogPost'))
    it('세 단어: user_login_histories → UserLoginHistory', () => {
      expect(defaultNaming.select('user_login_histories')).toBe('UserLoginHistory')
    })
  })
})

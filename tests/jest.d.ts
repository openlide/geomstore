/**
 * Jest全局类型定义
 * 用于测试文件的类型检查
 */

declare global {
  interface JestMatchers<R = any> {
    toHaveBeenCalledTimes(n: number): R
    toHaveBeenCalled(): R
    toHaveBeenCalledWith(...args: any[]): R
    toHaveBeenCalledNthWith(n: number, ...args: any[]): R
    toHaveBeenCalledOnce(): R
    toThrow(error?: Error | string | RegExp): R
    toBe(expected: any): R
    toEqual(expected: any): R
    toBeDefined(): R
    toBeUndefined(): R
    toBeNull(): R
    toBeTruthy(): R
    toBeFalsy(): R
    toBeGreaterThan(n: number): R
    toBeLessThan(n: number): R
    toHaveLength(n: number): R
    toMatch(pattern: string | RegExp): R
    toContain(item: any): R
    toMatchObject(expected: any): R
  }
}

export {}

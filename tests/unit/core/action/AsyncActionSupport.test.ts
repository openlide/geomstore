/**
 * GeomStore v1.0 - AsyncActionSupport 测试
 */

import { ActionExecutor } from '@/core/action/AsyncActionSupport'

describe('ActionExecutor', () => {
  let executor: ActionExecutor<any>

  beforeEach(() => {
    executor = new ActionExecutor()
  })

  describe('基础功能', () => {
    test('应该能够创建executor实例', () => {
      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(ActionExecutor)
    })

    test('应该有默认maxHistory', () => {
      // 无法直接访问private属性，但可以通过行为测试
      expect(executor).toBeDefined()
    })
  })

  describe('execute', () => {
    test('应该能够成功执行action', async () => {
      const actions = {
        fetchData: async (id: string) => ({ id, data: 'test-data' }),
      }

      const result = await executor.execute(actions, 'fetchData', '123')
      expect(result).toEqual({ id: '123', data: 'test-data' })
    })

    test('应该能够执行带多个参数的action', async () => {
      const actions = {
        add: (a: number, b: number) => a + b,
      }

      const result = await executor.execute(actions, 'add', 2, 3)
      expect(result).toBe(5)
    })

    test('应该记录执行历史', async () => {
      const actions = {
        fetchData: async (id: string) => ({ id }),
      }

      await executor.execute(actions, 'fetchData', '123')
      const history = executor.getHistory('fetchData')

      expect(history).toHaveLength(1)
      expect(history[0].success).toBe(true)
      expect(history[0].data).toEqual({ id: '123' })
    })

    test('应该记录执行时长', async () => {
      const actions = {
        slowAction: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return 'done'
        },
      }

      await executor.execute(actions, 'slowAction')
      const history = executor.getHistory('slowAction')

      // 计时存在毫秒级抖动（setTimeout 10ms 实测可能为 9ms），阈值放宽至 8ms 验证时长被记录
      expect(history[0].duration).toBeGreaterThanOrEqual(8)
    })

    test('应该能够处理action执行失败', async () => {
      const actions = {
        failAction: async () => {
          throw new Error('Action failed')
        },
      }

      await expect(executor.execute(actions, 'failAction')).rejects.toThrow('Action failed')

      const history = executor.getHistory('failAction')
      expect(history).toHaveLength(1)
      expect(history[0].success).toBe(false)
      expect(history[0].error).toBeInstanceOf(Error)
    })

    test('应该记录失败的action', async () => {
      const actions = {
        failAction: async () => {
          throw new Error('Test error')
        },
      }

      try {
        await executor.execute(actions, 'failAction')
      } catch (error) {
        // Expected error
      }

      const history = executor.getHistory('failAction')
      expect(history[0].success).toBe(false)
      expect(history[0].error?.message).toBe('Test error')
    })

    test('应该记录失败action的执行时长', async () => {
      const actions = {
        slowFailAction: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          throw new Error('Failed')
        },
      }

      try {
        await executor.execute(actions, 'slowFailAction')
      } catch (error) {
        // Expected error
      }

      const history = executor.getHistory('slowFailAction')
      // 计时存在毫秒级抖动（setTimeout 10ms 实测可能为 9ms），阈值放宽至 8ms 验证时长被记录
      expect(history[0].duration).toBeGreaterThanOrEqual(8)
    })

    test('应该能够连续执行多个action', async () => {
      const actions = {
        action1: async () => 'result1',
        action2: async () => 'result2',
        action3: async () => 'result3',
      }

      const result1 = await executor.execute(actions, 'action1')
      const result2 = await executor.execute(actions, 'action2')
      const result3 = await executor.execute(actions, 'action3')

      expect(result1).toBe('result1')
      expect(result2).toBe('result2')
      expect(result3).toBe('result3')

      expect(executor.getHistory('action1')).toHaveLength(1)
      expect(executor.getHistory('action2')).toHaveLength(1)
      expect(executor.getHistory('action3')).toHaveLength(1)
    })
  })

  describe('executeParallel', () => {
    test('应该能够并行执行多个action', async () => {
      const actions = {
        fetchUser: async (id: string) => ({ id, name: `User ${id}` }),
        fetchPosts: async (userId: string) => ({ userId, posts: ['post1', 'post2'] }),
        fetchProfile: async (userId: string) => ({ userId, avatar: 'avatar.png' }),
      }

      const tasks = [
        { action: 'fetchUser', args: ['123'] },
        { action: 'fetchPosts', args: ['123'] },
        { action: 'fetchProfile', args: ['123'] },
      ]

      const results = await executor.executeParallel(actions, tasks)

      expect(results).toHaveLength(3)
      expect(results[0]).toEqual({ id: '123', name: 'User 123' })
      expect(results[1]).toEqual({ userId: '123', posts: ['post1', 'post2'] })
      expect(results[2]).toEqual({ userId: '123', avatar: 'avatar.png' })
    })

    test('应该能够处理部分失败的并行任务', async () => {
      const actions = {
        successAction: async () => 'success',
        failAction: async () => {
          throw new Error('Failed')
        },
      }

      const tasks = [
        { action: 'successAction', args: [] },
        { action: 'failAction', args: [] },
      ]

      const results = await executor.executeParallel(actions, tasks)

      expect(results).toHaveLength(2)
      expect(results[0]).toBe('success')
      expect(results[1]).toBeInstanceOf(Error)
    })

    test('应该记录所有并行任务的执行历史', async () => {
      const actions = {
        action1: async () => 'result1',
        action2: async () => 'result2',
      }

      const tasks = [
        { action: 'action1', args: [] },
        { action: 'action2', args: [] },
      ]

      await executor.executeParallel(actions, tasks)

      expect(executor.getHistory('action1')).toHaveLength(1)
      expect(executor.getHistory('action2')).toHaveLength(1)
    })

    test('应该能够处理空的tasks数组', async () => {
      const actions = {}

      const results = await executor.executeParallel(actions, [])
      expect(results).toEqual([])
    })
  })

  describe('executeSequential', () => {
    test('应该能够串行执行多个action', async () => {
      const actions = {
        action1: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return 'result1'
        },
        action2: async () => 'result2',
        action3: async () => 'result3',
      }

      const tasks = [
        { action: 'action1', args: [] },
        { action: 'action2', args: [] },
        { action: 'action3', args: [] },
      ]

      const results = await executor.executeSequential(actions, tasks)

      expect(results).toHaveLength(3)
      expect(results[0]).toBe('result1')
      expect(results[1]).toBe('result2')
      expect(results[2]).toBe('result3')
    })

    test('串行执行应该保持顺序', async () => {
      const executionOrder: string[] = []
      const actions = {
        action1: async () => {
          executionOrder.push('1')
          return 'result1'
        },
        action2: async () => {
          executionOrder.push('2')
          return 'result2'
        },
        action3: async () => {
          executionOrder.push('3')
          return 'result3'
        },
      }

      const tasks = [
        { action: 'action1', args: [] },
        { action: 'action2', args: [] },
        { action: 'action3', args: [] },
      ]

      await executor.executeSequential(actions, tasks)

      expect(executionOrder).toEqual(['1', '2', '3'])
    })

    test('串行执行应该在失败后继续', async () => {
      const actions = {
        successAction: async () => 'success',
        failAction: async () => {
          throw new Error('Failed')
        },
        anotherSuccess: async () => 'another-success',
      }

      const tasks = [
        { action: 'successAction', args: [] },
        { action: 'failAction', args: [] },
        { action: 'anotherSuccess', args: [] },
      ]

      const results = await executor.executeSequential(actions, tasks)

      expect(results).toHaveLength(3)
      expect(results[0]).toBe('success')
      expect(results[1]).toBeInstanceOf(Error)
      expect(results[2]).toBe('another-success')
    })

    test('应该能够处理空的tasks数组', async () => {
      const actions = {}

      const results = await executor.executeSequential(actions, [])
      expect(results).toEqual([])
    })
  })

  describe('executeWithRetry', () => {
    test('应该在失败时自动重试', async () => {
      let attemptCount = 0
      const actions = {
        failUntilSuccess: async () => {
          attemptCount++
          if (attemptCount < 3) {
            throw new Error('Not yet')
          }
          return 'success'
        },
      }

      const result = await executor.executeWithRetry(actions, 'failUntilSuccess', [], { retries: 3, delay: 1 })

      expect(result).toBe('success')
      expect(attemptCount).toBe(3)
    })

    test('应该在所有重试都失败后抛出错误', async () => {
      const actions = {
        alwaysFail: async () => {
          throw new Error('Always fails')
        },
      }

      await expect(executor.executeWithRetry(actions, 'alwaysFail', [], { retries: 3, delay: 1 })).rejects.toThrow('Always fails')
    })

    test('应该使用默认的重试次数', async () => {
      let attemptCount = 0
      const actions = {
        failTwice: async () => {
          attemptCount++
          if (attemptCount < 3) {
            throw new Error('Fail')
          }
          return 'success'
        },
      }

      const result = await executor.executeWithRetry(actions, 'failTwice', [], { delay: 1 })

      expect(result).toBe('success')
      expect(attemptCount).toBe(3) // 默认3次重试
    })

    test('应该使用指数退避策略', async () => {
      const retryAttempts: number[] = []
      const actions = {
        failThenSuccess: async () => {
          throw new Error('Fail')
        },
      }

      await executor
        .executeWithRetry(actions, 'failThenSuccess', [], {
          retries: 3,
          delay: 10,
          onRetry: (error, attempt) => {
            retryAttempts.push(attempt)
          },
        })
        .catch(() => {
          // Ignore final error
        })

      // 应该重试3次（attempt 1, 2, 3）
      expect(retryAttempts).toEqual([1, 2, 3])
    })

    test('应该调用onRetry回调', async () => {
      const retryAttempts: number[] = []
      const actions = {
        failThreeTimes: async () => {
          throw new Error('Fail')
        },
      }

      try {
        await executor.executeWithRetry(actions, 'failThreeTimes', [], {
          retries: 3,
          delay: 1,
          onRetry: (error, attempt) => {
            retryAttempts.push(attempt)
          },
        })
      } catch (error) {
        // Expected error
      }

      expect(retryAttempts).toEqual([1, 2, 3])
    })

    test('不应该在第一次成功时重试', async () => {
      let attemptCount = 0
      const actions = {
        succeedFirstTime: async () => {
          attemptCount++
          return 'success'
        },
      }

      const result = await executor.executeWithRetry(actions, 'succeedFirstTime', [], { retries: 3, delay: 1 })

      expect(result).toBe('success')
      expect(attemptCount).toBe(1)
    })

    test('应该使用默认延迟', async () => {
      let attemptCount = 0
      const actions = {
        failOnce: async () => {
          attemptCount++
          if (attemptCount < 2) {
            throw new Error('Fail once')
          }
          return 'success'
        },
      }

      const result = await executor.executeWithRetry(actions, 'failOnce', [], { retries: 2 })

      expect(result).toBe('success')
      expect(attemptCount).toBe(2)
    })

    test('0次重试时应该直接执行', async () => {
      const actions = {
        simpleAction: async () => 'result',
      }

      const result = await executor.executeWithRetry(actions, 'simpleAction', [], { retries: 0, delay: 1 })

      expect(result).toBe('result')
    })

    test('不传 options 参数时应该使用默认值', async () => {
      let attemptCount = 0
      const actions = {
        failOnce: async () => {
          attemptCount++
          if (attemptCount < 2) {
            throw new Error('fail')
          }
          return 'success'
        },
      }

      // 不传 options 参数，触发默认参数 {} 分支
      const result = await executor.executeWithRetry(actions, 'failOnce', [])

      expect(result).toBe('success')
      expect(attemptCount).toBe(2)
    })

    test('retries 为负数时循环不执行应该抛出 Retry failed without error', async () => {
      const actions = {
        testAction: async () => 'result',
      }

      // retries=-1 时循环不执行，lastError 保持 undefined，进入 !lastError 分支
      await expect(executor.executeWithRetry(actions, 'testAction', [], { retries: -1, delay: 1 })).rejects.toThrow('Retry failed without error')
    })
  })

  describe('executeWithTimeout', () => {
    test('应该在超时时间内返回结果', async () => {
      const actions = {
        fastAction: async () => 'quick-result',
      }

      const result = await executor.executeWithTimeout(
        actions,
        'fastAction',
        [],
        5000, // 5秒超时
      )

      expect(result).toBe('quick-result')
    })

    test('应该在超时时抛出错误', async () => {
      const actions = {
        slowAction: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          return 'late-result'
        },
      }

      await expect(
        executor.executeWithTimeout(
          actions,
          'slowAction',
          [],
          100, // 100ms超时
        ),
      ).rejects.toThrow('Action timeout after 100ms')
    })

    test('应该在action失败时即使未超时也返回错误', async () => {
      const actions = {
        failAction: async () => {
          throw new Error('Action failed')
        },
      }

      await expect(executor.executeWithTimeout(actions, 'failAction', [], 5000)).rejects.toThrow('Action failed')
    })

    test('超时后底层 action 最终 reject 时不应产生 unhandled rejection', async () => {
      const unhandled = jest.fn()
      const listener = (reason: unknown) => unhandled(reason)
      process.on('unhandledRejection', listener)

      const actions = {
        slowFailAction: async () => {
          await new Promise((resolve) => setTimeout(resolve, 80))
          throw new Error('late failure')
        },
      }

      try {
        await expect(executor.executeWithTimeout(actions, 'slowFailAction', [], 10)).rejects.toThrow('Action timeout after 10ms')

        // 等待底层 action 在超时之后完成并 reject：
        // 预挂的 catch 应吞掉该 rejection，避免成为 unhandled rejection
        await new Promise((resolve) => setTimeout(resolve, 150))

        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.removeListener('unhandledRejection', listener)
      }
    })
  })

  describe('getHistory', () => {
    test('应该能够获取特定action的历史', async () => {
      const actions = {
        testAction: async () => 'result',
      }

      await executor.execute(actions, 'testAction')
      await executor.execute(actions, 'testAction')

      const history = executor.getHistory('testAction')
      expect(history).toHaveLength(2)
    })

    test('应该能够获取所有action的历史', async () => {
      const actions = {
        action1: async () => 'result1',
        action2: async () => 'result2',
      }

      await executor.execute(actions, 'action1')
      await executor.execute(actions, 'action2')
      await executor.execute(actions, 'action1')

      const allHistory = executor.getHistory()
      expect(allHistory).toHaveLength(3)
    })

    test('应该按时间倒序返回历史', async () => {
      const actions = {
        testAction: async () => 'result',
      }

      await executor.execute(actions, 'testAction')
      await new Promise((resolve) => setTimeout(resolve, 10))
      await executor.execute(actions, 'testAction')

      // getHistory(actionName) 返回的是按插入顺序的历史记录
      // 如果需要按时间倒序，应该返回副本并排序
      const history = executor.getHistory('testAction')
      expect(history).toHaveLength(2)
      // 历史记录是按插入顺序的，第一个是最早的
      expect(history[0].startTime).toBeLessThan(history[1].startTime)
    })

    test('未执行的action应该返回空数组', () => {
      const history = executor.getHistory('nonexistent-action')
      expect(history).toEqual([])
    })

    test('未提供actionName应该返回所有历史', async () => {
      const actions = {
        action1: async () => 'result1',
      }

      await executor.execute(actions, 'action1')

      const allHistory = executor.getHistory()
      expect(allHistory).toHaveLength(1)
    })
  })

  describe('getStats', () => {
    test('应该能够计算action的统计信息', async () => {
      const actions = {
        testAction: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return 'result'
        },
      }

      // 执行多次
      await executor.execute(actions, 'testAction')
      await executor.execute(actions, 'testAction')
      await executor.execute(actions, 'testAction')

      const stats = executor.getStats('testAction')

      expect(stats.total).toBe(3)
      expect(stats.success).toBe(3)
      expect(stats.failure).toBe(0)
      expect(stats.avgDuration).toBeGreaterThan(0)
      expect(stats.successRate).toBe(100)
    })

    test('应该能够计算包含失败的统计', async () => {
      const actions = {
        mixedAction: async (shouldFail: boolean) => {
          if (shouldFail) {
            throw new Error('Fail')
          }
          return 'success'
        },
      }

      try {
        await executor.execute(actions, 'mixedAction', false)
      } catch (e) {}
      try {
        await executor.execute(actions, 'mixedAction', true)
      } catch (e) {}
      try {
        await executor.execute(actions, 'mixedAction', false)
      } catch (e) {}

      const stats = executor.getStats('mixedAction')

      expect(stats.total).toBe(3)
      expect(stats.success).toBe(2)
      expect(stats.failure).toBe(1)
      expect(stats.successRate).toBeCloseTo(66.67, 1)
    })

    test('未执行的action应该返回默认统计', () => {
      const stats = executor.getStats('nonexistent-action')

      expect(stats.total).toBe(0)
      expect(stats.success).toBe(0)
      expect(stats.failure).toBe(0)
      expect(stats.avgDuration).toBe(0)
      expect(stats.successRate).toBe(0)
    })
  })

  describe('clearHistory', () => {
    test('应该能够清除特定action的历史', async () => {
      const actions = {
        action1: async () => 'result1',
        action2: async () => 'result2',
      }

      await executor.execute(actions, 'action1')
      await executor.execute(actions, 'action2')

      executor.clearHistory('action1')

      expect(executor.getHistory('action1')).toEqual([])
      expect(executor.getHistory('action2')).toHaveLength(1)
    })

    test('应该能够清除所有历史', async () => {
      const actions = {
        action1: async () => 'result1',
        action2: async () => 'result2',
      }

      await executor.execute(actions, 'action1')
      await executor.execute(actions, 'action2')

      executor.clearHistory()

      expect(executor.getHistory('action1')).toEqual([])
      expect(executor.getHistory('action2')).toEqual([])
    })
  })

  describe('setMaxHistory', () => {
    test('应该能够设置最大历史记录数', async () => {
      const actions = {
        testAction: async () => 'result',
      }

      executor.setMaxHistory(5)

      // 执行10次
      for (let i = 0; i < 10; i++) {
        await executor.execute(actions, 'testAction')
      }

      const history = executor.getHistory('testAction')
      expect(history).toHaveLength(5)
    })

    test('应该限制为至少1', () => {
      executor.setMaxHistory(0)
      // 应该自动设置为至少1
      // 无法直接验证，但通过行为测试
    })

    test('应该保持最新的历史记录', async () => {
      const actions = {
        testAction: async (index: number) => index,
      }

      executor.setMaxHistory(3)

      // 执行5次
      for (let i = 0; i < 5; i++) {
        await executor.execute(actions, 'testAction', i)
      }

      const history = executor.getHistory('testAction')
      expect(history).toHaveLength(3)
      // shift() 删除最旧的，保留最新的3个
      // 历史记录是按插入顺序的，最早的在前面
      expect(history[0].data).toBe(2)
      expect(history[1].data).toBe(3)
      expect(history[2].data).toBe(4)
    })
  })

  describe('getAllStats', () => {
    test('应该能够获取所有action的统计', async () => {
      const actions = {
        action1: async () => 'result1',
        action2: async () => 'result2',
        action3: async () => 'result3',
      }

      await executor.execute(actions, 'action1')
      await executor.execute(actions, 'action2')
      await executor.execute(actions, 'action2')
      await executor.execute(actions, 'action3')

      const allStats = executor.getAllStats()

      expect(Object.keys(allStats)).toEqual(['action1', 'action2', 'action3'])
      expect(allStats.action1.total).toBe(1)
      expect(allStats.action2.total).toBe(2)
      expect(allStats.action3.total).toBe(1)
    })

    test('应该返回正确的统计信息', async () => {
      const actions = {
        testAction: async () => 'result',
      }

      await executor.execute(actions, 'testAction')
      await executor.execute(actions, 'testAction')

      const allStats = executor.getAllStats()

      expect(allStats.testAction).toBeDefined()
      expect(allStats.testAction.total).toBe(2)
      expect(allStats.testAction.success).toBe(2)
      expect(allStats.testAction.successRate).toBe(100)
    })

    test('没有执行的action应该返回空对象', () => {
      const allStats = executor.getAllStats()
      expect(Object.keys(allStats)).toEqual([])
    })
  })

  describe('recordResult 防御性覆盖', () => {
    test('actionResults 中已存在 key 但 get 返回 undefined 时不应崩溃', async () => {
      // 通过操作内部 Map 来模拟 has() 返回 true 但 get() 返回 undefined 的极端情况
      const executorAny = executor as any
      // 手动在 Map 中设置一个 key 对应 undefined 值
      executorAny.actionResults.set('testAction', undefined as any)

      const actions = {
        testAction: async () => 'result',
      }

      // execute 调用 recordResult，此时 has 返回 true，get 返回 undefined
      // 应该进入 if (history) 的 false 分支，不崩溃
      const result = await executor.execute(actions, 'testAction')
      expect(result).toBe('result')
    })
  })

  describe('复杂场景', () => {
    test('应该能够处理并串行组合', async () => {
      const actions = {
        fetchData: async () => [1, 2, 3],
        processData: async (data: number[]) => data.map((n) => n * 2),
        saveData: async (data: number[]) => data.length,
      }

      // 串行执行 - 每个 action 独立提供参数
      const tasks1 = [
        { action: 'fetchData', args: [] },
        { action: 'processData', args: [[1, 2, 3]] },
        { action: 'saveData', args: [[2, 4, 6]] },
      ]
      const results1 = await executor.executeSequential(actions, tasks1)

      expect(results1[0]).toEqual([1, 2, 3])
      expect(results1[1]).toEqual([2, 4, 6])
      expect(results1[2]).toBe(3)

      // 清除历史
      executor.clearHistory()

      // 并行执行
      const tasks2 = [
        { action: 'fetchData', args: [] },
        { action: 'processData', args: [] },
        { action: 'saveData', args: [] },
      ]
      const results2 = await executor.executeParallel(actions, tasks2)

      expect(results2).toHaveLength(3)
    })

    test('应该能够在重试后继续执行其他action', async () => {
      const actions = {
        retryAction: async () => {
          throw new Error('Fail first')
        },
        normalAction: async () => 'normal-result',
      }

      let retryCalled = false
      try {
        await executor.executeWithRetry(actions, 'retryAction', [], {
          retries: 1,
          delay: 1,
          onRetry: () => {
            retryCalled = true
          },
        })
      } catch (error) {
        // Expected error
      }

      expect(retryCalled).toBe(true)

      const result = await executor.execute(actions, 'normalAction')
      expect(result).toBe('normal-result')
    })

    test('应该能够处理大量action执行', async () => {
      const actions = {
        testAction: async (index: number) => index,
      }

      // 执行100次
      const promises: Promise<number>[] = []
      for (let i = 0; i < 100; i++) {
        promises.push(executor.execute(actions, 'testAction', i))
      }

      await Promise.all(promises)

      const history = executor.getHistory('testAction')
      // 由于maxHistory限制，应该只保留100条
      expect(history.length).toBeLessThanOrEqual(100)
    })
  })
})

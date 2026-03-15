import { useState, useEffect, useCallback, useRef } from 'react';
import { LarkMessage } from '@/types';
import {
  getMessages,
  MessageFilters,
  MessageSort,
  MessagePagination
} from '@/services/messagesService';

export interface UseMessagesOptions {
  filters: MessageFilters;
  sort: MessageSort | null;
  pagination: MessagePagination;
  enabled?: boolean; // 是否启用查询（默认 true）
}

export interface UseMessagesReturn {
  // 数据
  messages: LarkMessage[];
  total: number;
  totalPages: number;

  // 状态
  loading: boolean;
  error: Error | null;

  // 操作
  refetch: () => Promise<void>;
}

/**
 * 获取消息列表的自定义 Hook
 * @param options - 查询选项
 * @returns 消息数据和状态
 */
export function useMessages(options: UseMessagesOptions): UseMessagesReturn {
  const { filters, sort, pagination, enabled = true } = options;

  const [messages, setMessages] = useState<LarkMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // 使用 ref 存储 AbortController，防止竞态条件
  const abortControllerRef = useRef<AbortController | null>(null);

  // 获取数据的核心函数
  const fetchMessages = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const result = await getMessages(filters, sort, pagination);

      // 检查请求是否被取消
      if (abortControllerRef.current?.signal.aborted) {
        return;
      }

      setMessages(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      // 检查是否是取消错误
      if (abortControllerRef.current?.signal.aborted) {
        return;
      }

      const errorMessage = err instanceof Error ? err : new Error('获取消息失败');
      setError(errorMessage);
      setMessages([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [filters, sort, pagination, enabled]);

  // 监听参数变化，自动重新获取数据
  useEffect(() => {
    fetchMessages();

    // 清理函数：组件卸载时取消请求
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchMessages]);

  // 手动刷新函数
  const refetch = useCallback(async () => {
    await fetchMessages();
  }, [fetchMessages]);

  return {
    messages,
    total,
    totalPages,
    loading,
    error,
    refetch
  };
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { useCluster } from '@/hooks/use-cluster'

import { ClusterProvider } from './cluster-context'

const { mockRefetchClusters } = vi.hoisted(() => ({
  mockRefetchClusters: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  useCurrentClusterList: () => ({
    refetch: mockRefetchClusters,
  }),
}))

function ClusterConsumer() {
  const { currentCluster, error, enterCluster } = useCluster()
  return (
    <>
      <div data-testid="current-cluster">{currentCluster}</div>
      <div data-testid="cluster-error">{error?.message || ''}</div>
      <button onClick={() => void enterCluster('broken')}>enter broken</button>
    </>
  )
}

function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ClusterProvider>
        <ClusterConsumer />
      </ClusterProvider>
    </QueryClientProvider>
  )
}

describe('ClusterProvider', () => {
  it('restores a healthy stored cluster after restart', async () => {
    localStorage.setItem('current-cluster', 'usw-1')
    mockRefetchClusters.mockResolvedValue({
      data: [
        {
          name: 'c3vjdl7g@sealos',
          version: 'v1.33.6',
          isDefault: true,
          defaultNamespace: 'ns-38cq5qwz',
        },
        {
          name: 'usw-1',
          version: 'v1.33.6',
          isDefault: false,
          defaultNamespace: 'default',
        },
      ],
    })

    renderProvider()

    await waitFor(() => {
      expect(screen.getByTestId('current-cluster')).toHaveTextContent('usw-1')
    })
    expect(localStorage.getItem('current-cluster')).toBe('usw-1')
  })

  it('clears an unhealthy stored cluster without auto-entering another cluster', async () => {
    localStorage.setItem('current-cluster', 'orbstack')
    mockRefetchClusters.mockResolvedValue({
      data: [
        {
          name: 'c3vjdl7g@sealos',
          version: 'v1.33.6',
          isDefault: true,
          defaultNamespace: 'ns-38cq5qwz',
        },
        {
          name: 'orbstack',
          version: '',
          isDefault: false,
          error: 'connection refused',
          defaultNamespace: 'default',
        },
      ],
    })

    renderProvider()

    await waitFor(() => {
      expect(screen.getByTestId('current-cluster')).toBeEmptyDOMElement()
    })
    expect(localStorage.getItem('current-cluster')).toBeNull()
  })

  it('keeps rendering children when cluster list loading fails', async () => {
    mockRefetchClusters.mockResolvedValue({
      error: new Error('cluster list failed'),
    })

    renderProvider()

    await waitFor(() => {
      expect(screen.getByTestId('cluster-error')).toHaveTextContent(
        'cluster list failed'
      )
    })
    expect(screen.getByTestId('current-cluster')).toBeInTheDocument()
  })

  it('does not enter a cluster with a connection error', async () => {
    localStorage.removeItem('current-cluster')
    mockRefetchClusters.mockResolvedValue({
      data: [
        {
          name: 'broken',
          version: '',
          isDefault: false,
          error: '集群认证失败：请重新导入 kubeconfig。',
          defaultNamespace: 'default',
        },
      ],
    })

    renderProvider()

    await waitFor(() => {
      expect(screen.getByTestId('current-cluster')).toBeEmptyDOMElement()
    })

    await userEvent.click(screen.getByRole('button', { name: 'enter broken' }))

    expect(screen.getByTestId('current-cluster')).toBeEmptyDOMElement()
    expect(localStorage.getItem('current-cluster')).toBeNull()
  })
})

import { useState, type MouseEvent, type PointerEvent } from 'react'
import {
  IconAlertCircle,
  IconCircleCheckFilled,
  IconDatabase,
  IconPlus,
  IconServer,
  IconTrash,
} from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import type { Cluster } from '@/types/api'
import { deleteCluster } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useCluster } from '@/hooks/use-cluster'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { SidebarClusterManagement } from '@/components/sidebar-cluster-management'

function formatClusterType(cluster: Cluster) {
  return cluster.inCluster ? '集群内' : '外部集群'
}

const NO_DRAG_SELECTOR =
  ".electron-no-drag, button, input, a, textarea, select, [role='button'], [role='combobox'], [data-radix-popper-content-wrapper]"

function isNoDragTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(NO_DRAG_SELECTOR))
}

function ClusterCard({
  cluster,
  isActive,
  onEnter,
  onDelete,
  isDeleting,
}: {
  cluster: Cluster
  isActive: boolean
  onEnter: (clusterName: string) => void
  onDelete: (cluster: Cluster) => void
  isDeleting: boolean
}) {
  const hasError = Boolean(cluster.error)
  const isDisabled = hasError || cluster.enabled === false

  return (
    <Card
      className={cn(
        'group overflow-hidden rounded-lg border bg-card/70 py-0 transition-colors hover:border-primary/50',
        isActive && 'border-primary/60 bg-primary/5'
      )}
    >
      <CardHeader className="border-b px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                hasError
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-primary/10 text-primary'
              )}
            >
              <IconServer className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-lg">
                {cluster.name}
              </CardTitle>
              <CardDescription className="mt-1 truncate">
                {cluster.description || formatClusterType(cluster)}
              </CardDescription>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {cluster.isDefault ? <Badge variant="secondary">默认</Badge> : null}
            {isActive ? <Badge>当前</Badge> : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              disabled={isDeleting}
              title="删除集群"
              aria-label={`删除集群 ${cluster.name}`}
              onClick={() => onDelete(cluster)}
            >
              <IconTrash className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">版本</div>
            <div className="mt-1 truncate font-mono">
              {cluster.version || '-'}
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">类型</div>
            <div className="mt-1 truncate">{formatClusterType(cluster)}</div>
          </div>
        </div>

        <div
          className={cn(
            'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
            hasError
              ? 'border-destructive/30 bg-destructive/5 text-destructive'
              : 'border-green-500/20 bg-green-500/5 text-green-600 dark:text-green-400'
          )}
        >
          {hasError ? (
            <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <IconCircleCheckFilled className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span className="min-w-0 break-words">
            {cluster.error || '连接正常，可以进入工作台'}
          </span>
        </div>

        <Button
          className="w-full"
          disabled={isDisabled}
          onClick={() => onEnter(cluster.name)}
        >
          进入集群
        </Button>
      </CardContent>
    </Card>
  )
}

function ClusterLandingSkeleton() {
  return (
    <div className="grid gap-4 @3xl/main:grid-cols-2 @6xl/main:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index} className="rounded-lg py-0">
          <CardHeader className="border-b px-5 py-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-44" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-5 py-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function ClusterLandingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const {
    clusters,
    currentCluster,
    enterCluster,
    isLoading,
    isSwitching,
    refreshClusters,
  } = useCluster()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [deletingCluster, setDeletingCluster] = useState<Cluster | null>(null)

  const deleteMutation = useMutation({
    mutationFn: deleteCluster,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cluster-list'] }),
        queryClient.invalidateQueries({ queryKey: ['clusters'] }),
      ])
      await refreshClusters()
      toast.success(
        t('clusterManagement.messages.deleted', '集群删除成功')
      )
      setDeletingCluster(null)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t('clusterManagement.messages.deleteError', '删除集群失败')
      )
    },
  })

  const handleEnterCluster = async (clusterName: string) => {
    await enterCluster(clusterName)
    navigate('/dashboard')
  }

  const handleDeleteCluster = () => {
    if (!deletingCluster) {
      return
    }
    deleteMutation.mutate(deletingCluster.id)
  }

  const handleWindowDragStart = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !window.kiteWindow || isNoDragTarget(event.target)) {
      return
    }

    window.kiteWindow.startDrag({
      screenX: event.screenX,
      screenY: event.screenY,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleWindowDragMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!window.kiteWindow || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return
    }

    window.kiteWindow.dragTo({
      screenX: event.screenX,
      screenY: event.screenY,
    })
  }

  const handleWindowDragEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!window.kiteWindow) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.kiteWindow.endDrag()
  }

  const handleWindowDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isNoDragTarget(event.target)) {
      return
    }

    void window.kiteWindow?.toggleMaximize()
  }

  return (
    <div
      className="flex min-h-dvh select-none items-center justify-center px-4 py-8 pt-16"
      onDoubleClick={handleWindowDoubleClick}
      onPointerDown={handleWindowDragStart}
      onPointerMove={handleWindowDragMove}
      onPointerUp={handleWindowDragEnd}
      onPointerCancel={handleWindowDragEnd}
    >
      <Card className="w-full max-w-5xl rounded-lg bg-card/80 py-0 shadow-sm">
        <CardHeader className="border-b px-6 py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-2xl">选择集群</CardTitle>
              <CardDescription>
                选择一个集群进入工作台，后续可在资源页内切换集群。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void refreshClusters()}>
                {t('common.actions.refresh', '刷新')}
              </Button>
              <SidebarClusterManagement
                open={isAddOpen}
                onOpenChange={setIsAddOpen}
                trigger={
                  <Button>
                    <IconPlus className="h-4 w-4" />
                    {t('clusterManagement.actions.add', '添加集群')}
                  </Button>
                }
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-6 py-5">
          {isLoading ? (
            <ClusterLandingSkeleton />
          ) : clusters.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <IconDatabase className="h-7 w-7" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">暂无集群</h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  添加第一个集群后，再进入 Kubernetes 资源工作台。
                </p>
              </div>
              <Button onClick={() => setIsAddOpen(true)}>
                <IconPlus className="h-4 w-4" />
                {t('clusterManagement.actions.add', '添加集群')}
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 @3xl/main:grid-cols-2">
              {clusters.map((cluster) => (
                <ClusterCard
                  key={cluster.name}
                  cluster={cluster}
                  isActive={cluster.name === currentCluster}
                  onEnter={handleEnterCluster}
                  onDelete={setDeletingCluster}
                  isDeleting={
                    deleteMutation.isPending &&
                    deletingCluster?.id === cluster.id
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isSwitching ? (
        <div className="fixed bottom-4 right-4 rounded-md border bg-background/95 px-3 py-2 text-sm shadow-lg">
          正在进入集群...
        </div>
      ) : null}

      <DeleteConfirmationDialog
        open={!!deletingCluster}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingCluster(null)
          }
        }}
        onConfirm={handleDeleteCluster}
        isDeleting={deleteMutation.isPending}
        resourceName={deletingCluster?.name || ''}
        resourceType="cluster"
        additionalNote={t(
          'clusterManagement.deleteConfirmation',
          '此操作仅移除 Kite 中的集群配置，不会删除集群内的任何资源。'
        )}
      />
    </div>
  )
}

import { Plus } from 'lucide-react'
import { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

import { ClusterManagement } from './settings/cluster-management'

interface SidebarClusterManagementProps {
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SidebarClusterManagement({
  trigger,
  open,
  onOpenChange,
}: SidebarClusterManagementProps) {
  const { t } = useTranslation()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t('clusterManagement.actions.add', 'Add Cluster')}
            title={t('clusterManagement.actions.add', 'Add Cluster')}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-[min(920px,calc(100vw-1rem))] sm:max-w-[920px]">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>
            {t('clusterManagement.title', 'Cluster Management')}
          </SheetTitle>
          <SheetDescription>
            {t(
              'clusterManagement.empty.description',
              'Add your first cluster to get started'
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ClusterManagement embedded />
        </div>
      </SheetContent>
    </Sheet>
  )
}

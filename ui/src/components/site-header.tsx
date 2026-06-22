import { useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { Database, Plus, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useCluster } from '@/hooks/use-cluster'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'

import { DynamicBreadcrumb } from './dynamic-breadcrumb'
import { ModeToggle } from './mode-toggle'
import { Search } from './search'
import { SidebarClusterManagement } from './sidebar-cluster-management'
import { ToolbarAppearanceControls } from './toolbar-appearance-controls'
import { UserMenu } from './user-menu'

export function SiteHeader() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { user, capabilities } = useAuth()
  const { currentCluster } = useCluster()
  const { state: sidebarState } = useSidebar()
  const [clusterManagementOpen, setClusterManagementOpen] = useState(false)
  const isAdmin = user?.isAdmin() ?? false
  const desktopMode = capabilities.desktopMode
  const hasClusterSelection = Boolean(currentCluster)
  const shouldOffsetMacControls = desktopMode && sidebarState === 'collapsed'

  return (
    <header className="electron-drag-region sticky top-0 z-50 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-[width,height] ease-linear select-none group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger
          className={cn(
            'transition-[margin] duration-200 focus-visible:ring-0 focus-visible:border-transparent',
            shouldOffsetMacControls ? 'ml-20' : '-ml-1'
          )}
        />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <DynamicBreadcrumb />
        <div className="ml-auto flex items-center gap-2">
          {hasClusterSelection ? (
            <>
              <Search />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/clusters')}
                className="hidden sm:flex"
                aria-label="选择集群"
                title="选择集群"
              >
                <Database className="h-5 w-5" />
                <span className="sr-only">选择集群</span>
              </Button>
              <SidebarClusterManagement
                open={clusterManagementOpen}
                onOpenChange={setClusterManagementOpen}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden sm:flex"
                    aria-label="添加集群"
                  >
                    <Plus className="h-5 w-5" />
                    <span className="sr-only">添加集群</span>
                  </Button>
                }
              />
            </>
          ) : null}
          {!isMobile && (
            <>
              <Separator
                orientation="vertical"
                className="mx-2 data-[orientation=vertical]:h-4"
              />
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate('/settings')}
                  className="hidden sm:flex"
                >
                  <Settings className="h-5 w-5" />
                  <span className="sr-only">Settings</span>
                </Button>
              )}
              {desktopMode && <ToolbarAppearanceControls />}
              <ModeToggle />
            </>
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  )
}

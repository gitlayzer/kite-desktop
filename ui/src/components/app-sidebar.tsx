import * as React from 'react'
import { useMemo } from 'react'
import Icon from '@/assets/icon.svg'
import { useAuth } from '@/contexts/auth-context'
import { useCluster } from '@/hooks/use-cluster'
import { useSidebarConfig } from '@/contexts/sidebar-config-context'
import { CollapsibleContent } from '@radix-ui/react-collapsible'
import { IconLayoutDashboard } from '@tabler/icons-react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

import { Collapsible, CollapsibleTrigger } from './ui/collapsible'

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation()
  const location = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  const { config, isLoading, getIconComponent } = useSidebarConfig()
  const { currentCluster } = useCluster()
  const { capabilities } = useAuth()
  const hasClusterSelection = Boolean(currentCluster)
  const desktopTitlebarPadding = capabilities.desktopMode ? 'pt-9' : undefined

  const pinnedItems = useMemo(() => {
    if (!config) return []
    return config.groups
      .flatMap((group) => group.items)
      .filter((item) => config.pinnedItems.includes(item.id))
      .filter((item) => !config.hiddenItems.includes(item.id))
  }, [config])

  const visibleGroups = useMemo(() => {
    if (!config) return []
    return config.groups
      .filter((group) => group.visible)
      .sort((a, b) => a.order - b.order)
      .map((group) => ({
        ...group,
        items: group.items
          .filter((item) => !config.hiddenItems.includes(item.id))
          .filter((item) => !config.pinnedItems.includes(item.id))
          .sort((a, b) => a.order - b.order),
      }))
      .filter((group) => group.items.length > 0)
  }, [config])

  const isActive = (url: string) => {
    if (url === '/') {
      return location.pathname === '/'
    }
    if (url === '/crds') {
      return location.pathname == '/crds'
    }
    return location.pathname.startsWith(url)
  }

  // Handle menu item click on mobile - close sidebar
  const handleMenuItemClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  if (isLoading || !config) {
    return (
      <Sidebar collapsible="offcanvas" {...props}>
        <SidebarHeader className={desktopTitlebarPadding}>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link
                  to={hasClusterSelection ? '/dashboard' : '/'}
                  onClick={handleMenuItemClick}
                >
                  <img src={Icon} alt="Kite Logo" className="ml-1 h-10 w-10" />
                  <span className="text-xl font-semibold">Kite</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <div className="p-4 text-center text-muted-foreground">
            {t('common.messages.loading', 'Loading...')}
          </div>
        </SidebarContent>
      </Sidebar>
    )
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className={desktopTitlebarPadding}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5 hover:bg-accent/50 transition-colors"
            >
              <Link
                to={hasClusterSelection ? '/dashboard' : '/'}
                onClick={handleMenuItemClick}
              >
                <div className="relative flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <img src={Icon} alt="Kite Logo" className="h-10 w-10" />
                    <div className="flex flex-col">
                      <span className="text-xl font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                        Kite
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {hasClusterSelection ? (
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t('nav.overview')}
                  asChild
                  isActive={isActive('/dashboard')}
                  className="transition-all duration-200 hover:bg-accent/60 active:scale-95 data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:shadow-sm"
                >
                  <Link to="/dashboard" onClick={handleMenuItemClick}>
                    <IconLayoutDashboard className="text-sidebar-primary" />
                    <span className="font-medium">{t('nav.overview')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

        {hasClusterSelection && pinnedItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t('sidebar.pinned', 'Pinned')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {pinnedItems.map((item) => {
                  const IconComponent = getIconComponent(item.icon)
                  const title = item.titleKey
                    ? t(item.titleKey, { defaultValue: item.titleKey })
                    : ''
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        tooltip={title}
                        asChild
                        isActive={isActive(item.url)}
                      >
                        <Link to={item.url} onClick={handleMenuItemClick}>
                          <IconComponent className="text-sidebar-primary" />
                          <span>{title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {hasClusterSelection
          ? visibleGroups.map((group) => (
              <Collapsible
                key={group.id}
                defaultOpen={!group.collapsed}
                className="group/collapsible"
              >
                <SidebarGroup>
                  <SidebarGroupLabel asChild>
                    <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors group-data-[state=open]:text-foreground">
                      <span className="uppercase tracking-wide text-xs font-bold">
                        {group.nameKey
                          ? t(group.nameKey, { defaultValue: group.nameKey })
                          : ''}
                      </span>
                      <ChevronDown className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                    </CollapsibleTrigger>
                  </SidebarGroupLabel>
                  <CollapsibleContent>
                    <SidebarGroupContent className="flex flex-col gap-2">
                      <SidebarMenu>
                        {group.items.map((item) => {
                          const IconComponent = getIconComponent(item.icon)
                          const title = item.titleKey
                            ? t(item.titleKey, { defaultValue: item.titleKey })
                            : ''
                          return (
                            <SidebarMenuItem key={item.id}>
                              <SidebarMenuButton
                                tooltip={title}
                                asChild
                                isActive={isActive(item.url)}
                              >
                                <Link
                                  to={item.url}
                                  onClick={handleMenuItemClick}
                                >
                                  <IconComponent className="text-sidebar-primary" />
                                  <span>{title}</span>
                                </Link>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          )
                        })}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>
            ))
          : null}
      </SidebarContent>

    </Sidebar>
  )
}

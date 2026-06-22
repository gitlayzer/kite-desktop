import './App.css'

import { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useSearchParams } from 'react-router-dom'

import { AIChatbox, StandaloneAIChatbox } from './components/ai-chat/ai-chatbox'
import { AppSidebar } from './components/app-sidebar'
import { ErrorBoundary } from './components/error-boundary'
import { GlobalSearch } from './components/global-search'
import {
  GlobalSearchProvider,
  useGlobalSearch,
} from './components/global-search-provider'
import { SiteHeader } from './components/site-header'
import { SidebarInset, SidebarProvider } from './components/ui/sidebar'
import { Toaster } from './components/ui/sonner'
import { AIChatProvider } from './contexts/ai-chat-context'
import { ClusterProvider } from './contexts/cluster-context'
import { useCluster } from './hooks/use-cluster'

function ClusterGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { isLoading, error } = useCluster()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex items-center space-x-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          <span>{t('cluster.loading')}</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-red-500">
          <p>{t('cluster.error', { error: error.message })}</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

function AppContent() {
  const { isOpen, closeSearch } = useGlobalSearch()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const { currentCluster } = useCluster()
  const isIframe = searchParams.get('iframe') === 'true'
  const isClusterEntryRoute =
    (location.pathname === '/' || location.pathname === '/clusters') &&
    !currentCluster

  if (isIframe) {
    return <Outlet />
  }

  if (isClusterEntryRoute) {
    return (
      <>
        <main className="@container/main min-h-dvh bg-background">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
        <Toaster />
      </>
    )
  }

  return (
    <>
      <SidebarProvider>
        <AppSidebar variant="inset" />
        <SidebarInset className="h-dvh overflow-y-auto overscroll-none scrollbar-hide">
          <SiteHeader />
          <div className="@container/main flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-4 py-4 md:gap-6">
              <div className="flex min-h-0 flex-1 flex-col px-4 lg:px-6">
                <ErrorBoundary>
                  <Outlet />
                </ErrorBoundary>
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
      {isOpen ? (
        <GlobalSearch open={isOpen} onOpenChange={closeSearch} />
      ) : null}
      <ErrorBoundary fallback={null}>
        <AIChatbox />
      </ErrorBoundary>
      <Toaster />
    </>
  )
}

function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ClusterProvider>
      <GlobalSearchProvider>
        <AIChatProvider>{children}</AIChatProvider>
      </GlobalSearchProvider>
    </ClusterProvider>
  )
}

function App() {
  return (
    <AppProviders>
      <ClusterGate>
        <AppContent />
      </ClusterGate>
    </AppProviders>
  )
}

export function StandaloneAIChatApp() {
  return (
    <AppProviders>
      <ClusterGate>
        <StandaloneAIChatbox />
      </ClusterGate>
    </AppProviders>
  )
}

export default App

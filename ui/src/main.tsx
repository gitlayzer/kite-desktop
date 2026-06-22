import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import './index.css'
import './i18n'

import { AppearanceProvider } from './components/appearance-provider'
import { AuthProvider } from './contexts/auth-context'
import { SidebarConfigProvider } from './contexts/sidebar-config-context'
import { QueryProvider } from './lib/query-provider'
import { router } from './routes'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryProvider>
      <AppearanceProvider
        defaultTheme="dark"
        themeStorageKey="kite-fixed-theme"
        defaultColorTheme="claude"
        colorThemeStorageKey="kite-fixed-color-theme"
        defaultFont="maple"
        fontStorageKey="kite-fixed-font"
        displayScaleStorageKey="kite-fixed-display-scale"
      >
        <AuthProvider>
          <SidebarConfigProvider>
            <RouterProvider router={router} />
          </SidebarConfigProvider>
        </AuthProvider>
      </AppearanceProvider>
    </QueryProvider>
  </StrictMode>
)

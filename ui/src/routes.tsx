import { createBrowserRouter, Navigate } from 'react-router-dom'

import App, { StandaloneAIChatApp } from './App'
import { ClusterEntryRoute } from './components/cluster-entry-route'
import { InitCheckRoute } from './components/init-check-route'
import { ProtectedRoute } from './components/protected-route'
import { RequireClusterSelection } from './components/require-cluster-selection'
import { getSubPath } from './lib/subpath'
import { CRListPage } from './pages/cr-list-page'
import { InitializationPage } from './pages/initialization'
import { LoginPage } from './pages/login'
import { Overview } from './pages/overview'
import { ResourceDetail } from './pages/resource-detail'
import { ResourceList } from './pages/resource-list'
import { SettingsPage } from './pages/settings'

const subPath = getSubPath()

export const router = createBrowserRouter(
  [
    {
      path: '/setup',
      element: <InitializationPage />,
    },
    {
      path: '/login',
      element: (
        <InitCheckRoute allowIncompleteSetup>
          <LoginPage />
        </InitCheckRoute>
      ),
    },
    {
      path: '/ai-chat-box',
      element: (
        <InitCheckRoute>
          <ProtectedRoute>
            <StandaloneAIChatApp />
          </ProtectedRoute>
        </InitCheckRoute>
      ),
    },
    {
      path: '/',
      element: (
        <InitCheckRoute>
          <ProtectedRoute>
            <App />
          </ProtectedRoute>
        </InitCheckRoute>
      ),
      children: [
        {
          index: true,
          element: <ClusterEntryRoute redirectWhenSelected />,
        },
        {
          path: 'clusters',
          element: <ClusterEntryRoute />,
        },
        {
          path: 'dashboard',
          element: (
            <RequireClusterSelection>
              <Overview />
            </RequireClusterSelection>
          ),
        },
        {
          path: 'settings',
          element: <SettingsPage />,
        },
        {
          path: 'charts',
          element: <Navigate to="/dashboard" replace />,
        },
        {
          path: 'charts/:repository/:name',
          element: <Navigate to="/dashboard" replace />,
        },
        {
          path: 'crds/:crd',
          element: (
            <RequireClusterSelection>
              <CRListPage />
            </RequireClusterSelection>
          ),
        },
        {
          path: 'crds/:resource/:namespace/:name',
          element: (
            <RequireClusterSelection>
              <ResourceDetail />
            </RequireClusterSelection>
          ),
        },
        {
          path: 'crds/:resource/:name',
          element: (
            <RequireClusterSelection>
              <ResourceDetail />
            </RequireClusterSelection>
          ),
        },
        {
          path: ':resource/:name',
          element: (
            <RequireClusterSelection>
              <ResourceDetail />
            </RequireClusterSelection>
          ),
        },
        {
          path: ':resource',
          element: (
            <RequireClusterSelection>
              <ResourceList />
            </RequireClusterSelection>
          ),
        },
        {
          path: ':resource/:namespace/:name',
          element: (
            <RequireClusterSelection>
              <ResourceDetail />
            </RequireClusterSelection>
          ),
        },
      ],
    },
  ],
  {
    basename: subPath,
  }
)

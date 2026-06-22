import { ClusterLandingPage } from '@/pages/cluster-landing'
import { Navigate } from 'react-router-dom'

import { useCluster } from '@/hooks/use-cluster'

export function ClusterEntryRoute({
  redirectWhenSelected = false,
}: {
  redirectWhenSelected?: boolean
}) {
  const { currentCluster, isLoading } = useCluster()

  if (isLoading) {
    return null
  }

  if (redirectWhenSelected && currentCluster) {
    return <Navigate to="/dashboard" replace />
  }

  return <ClusterLandingPage />
}

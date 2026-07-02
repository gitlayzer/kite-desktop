package model

import (
	"errors"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/common"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupClusterModelTestDB(t *testing.T) {
	t.Helper()

	oldDB := DB
	oldKey := common.KiteEncryptKey

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&Cluster{}); err != nil {
		t.Fatalf("automigrate cluster: %v", err)
	}

	DB = db
	t.Cleanup(func() {
		DB = oldDB
		common.KiteEncryptKey = oldKey
	})
}

func TestListClustersWithConfigStatusKeepsBadEncryptedRows(t *testing.T) {
	setupClusterModelTestDB(t)

	common.KiteEncryptKey = "machine-a"
	cluster := &Cluster{
		Name:   "copied-cluster",
		Config: SecretString("apiVersion: v1\nkind: Config\n"),
		Enable: true,
	}
	if err := AddCluster(cluster); err != nil {
		t.Fatalf("add cluster: %v", err)
	}

	common.KiteEncryptKey = "machine-b"
	items, err := ListClustersWithConfigStatus()
	if err != nil {
		t.Fatalf("list clusters with config status: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("len(items) = %d, want 1", len(items))
	}
	if items[0].Cluster.Name != "copied-cluster" {
		t.Fatalf("cluster name = %q, want copied-cluster", items[0].Cluster.Name)
	}
	if items[0].Cluster.Config != "" {
		t.Fatalf("bad config should not be exposed, got %q", items[0].Cluster.Config)
	}
	var decryptErr *ClusterConfigDecryptError
	if !errors.As(items[0].ConfigError, &decryptErr) {
		t.Fatalf("config error = %T, want ClusterConfigDecryptError", items[0].ConfigError)
	}
	if decryptErr.ClusterID != cluster.ID {
		t.Fatalf("decryptErr.ClusterID = %d, want %d", decryptErr.ClusterID, cluster.ID)
	}
}

func TestDeleteClusterByIDDoesNotDecryptConfig(t *testing.T) {
	setupClusterModelTestDB(t)

	common.KiteEncryptKey = "machine-a"
	cluster := &Cluster{
		Name:   "delete-me",
		Config: SecretString("apiVersion: v1\nkind: Config\n"),
		Enable: true,
	}
	if err := AddCluster(cluster); err != nil {
		t.Fatalf("add cluster: %v", err)
	}

	common.KiteEncryptKey = "machine-b"
	if err := DeleteClusterByID(cluster.ID); err != nil {
		t.Fatalf("delete cluster by id: %v", err)
	}

	count, err := CountClusters()
	if err != nil {
		t.Fatalf("count clusters: %v", err)
	}
	if count != 0 {
		t.Fatalf("count = %d, want 0", count)
	}
}

func TestListClustersWithConfigStatusDecryptsCurrentKeyRows(t *testing.T) {
	setupClusterModelTestDB(t)

	common.KiteEncryptKey = "same-machine"
	config := "apiVersion: v1\nkind: Config\n"
	cluster := &Cluster{
		Name:   "healthy-cluster",
		Config: SecretString(config),
		Enable: true,
	}
	if err := AddCluster(cluster); err != nil {
		t.Fatalf("add cluster: %v", err)
	}

	items, err := ListClustersWithConfigStatus()
	if err != nil {
		t.Fatalf("list clusters with config status: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("len(items) = %d, want 1", len(items))
	}
	if items[0].ConfigError != nil {
		t.Fatalf("config error = %v, want nil", items[0].ConfigError)
	}
	if string(items[0].Cluster.Config) != config {
		t.Fatalf("config = %q, want %q", items[0].Cluster.Config, config)
	}
}

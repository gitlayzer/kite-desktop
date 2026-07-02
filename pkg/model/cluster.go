package model

import (
	"fmt"
	"time"

	"github.com/zxh326/kite/pkg/utils"
	"gorm.io/gorm"
)

type Cluster struct {
	Model
	Name          string       `json:"name" gorm:"type:varchar(100);uniqueIndex;not null"`
	Description   string       `json:"description" gorm:"type:text"`
	Config        SecretString `json:"config" gorm:"type:text"`
	PrometheusURL string       `json:"prometheus_url,omitempty" gorm:"type:varchar(255)"`
	InCluster     bool         `json:"in_cluster" gorm:"type:boolean;default:false"`
	IsDefault     bool         `json:"is_default" gorm:"type:boolean;default:false"`
	Enable        bool         `json:"enable" gorm:"type:boolean;default:true"`
}

type ClusterConfigDecryptError struct {
	ClusterID   uint
	ClusterName string
	Err         error
}

func (e *ClusterConfigDecryptError) Error() string {
	return fmt.Sprintf("cluster %q config decrypt failed: %v", e.ClusterName, e.Err)
}

func (e *ClusterConfigDecryptError) Unwrap() error {
	return e.Err
}

type ClusterConfigStatus struct {
	Cluster     *Cluster
	ConfigError error
}

type clusterStorageRow struct {
	ID            uint
	CreatedAt     time.Time
	UpdatedAt     time.Time
	Name          string
	Description   string
	Config        string
	PrometheusURL string `gorm:"column:prometheus_url"`
	InCluster     bool   `gorm:"column:in_cluster"`
	IsDefault     bool   `gorm:"column:is_default"`
	Enable        bool
}

func AddCluster(cluster *Cluster) error {
	return DB.Create(cluster).Error
}

func GetClusterByName(name string) (*Cluster, error) {
	var cluster Cluster
	if err := DB.Where("name = ?", name).First(&cluster).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

func ClusterNameExists(name string) (bool, error) {
	var count int64
	if err := DB.Model(&Cluster{}).Where("name = ?", name).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func GetClusterByID(id uint) (*Cluster, error) {
	var cluster Cluster
	if err := DB.First(&cluster, id).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

func UpdateCluster(cluster *Cluster, updates map[string]interface{}) error {
	return DB.Model(cluster).Updates(updates).Error
}

func DeleteCluster(cluster *Cluster) error {
	return DB.Delete(cluster).Error
}

func DeleteClusterByID(id uint) error {
	result := DB.Delete(&Cluster{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func ClearDefaultCluster() error {
	return DB.Model(&Cluster{}).Where("is_default = ?", true).Update("is_default", false).Error
}

func DisableCluster(cluster *Cluster) error {
	return DB.Model(cluster).Update("enable", false).Error
}

func EnableCluster(cluster *Cluster) error {
	return DB.Model(cluster).Update("enable", true).Error
}

func ListClusters() ([]*Cluster, error) {
	var clusters []*Cluster
	if err := DB.Find(&clusters).Error; err != nil {
		return nil, err
	}
	return clusters, nil
}

func ListClustersWithConfigStatus() ([]*ClusterConfigStatus, error) {
	var rows []clusterStorageRow
	if err := DB.Table("clusters").Find(&rows).Error; err != nil {
		return nil, err
	}

	result := make([]*ClusterConfigStatus, 0, len(rows))
	for _, row := range rows {
		config, configErr := decryptClusterConfig(row)
		result = append(result, &ClusterConfigStatus{
			Cluster:     row.toCluster(config),
			ConfigError: configErr,
		})
	}
	return result, nil
}

func CountClusters() (count int64, err error) {
	return count, DB.Model(&Cluster{}).Count(&count).Error
}

func decryptClusterConfig(row clusterStorageRow) (SecretString, error) {
	if row.Config == "" {
		return "", nil
	}
	decrypted, err := utils.DecryptString(row.Config)
	if err != nil {
		return "", &ClusterConfigDecryptError{
			ClusterID:   row.ID,
			ClusterName: row.Name,
			Err:         err,
		}
	}
	return SecretString(decrypted), nil
}

func (row clusterStorageRow) toCluster(config SecretString) *Cluster {
	return &Cluster{
		Model: Model{
			ID:        row.ID,
			CreatedAt: row.CreatedAt,
			UpdatedAt: row.UpdatedAt,
		},
		Name:          row.Name,
		Description:   row.Description,
		Config:        config,
		PrometheusURL: row.PrometheusURL,
		InCluster:     row.InCluster,
		IsDefault:     row.IsDefault,
		Enable:        row.Enable,
	}
}

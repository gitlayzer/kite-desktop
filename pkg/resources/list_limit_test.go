package resources

import "testing"

func TestNormalizeListLimitDefaultsAndClamps(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    int64
		wantErr bool
	}{
		{name: "default", raw: "", want: defaultListLimit},
		{name: "zero uses default", raw: "0", want: defaultListLimit},
		{name: "negative uses default", raw: "-10", want: defaultListLimit},
		{name: "custom", raw: "250", want: 250},
		{name: "clamp max", raw: "50000", want: maxListLimit},
		{name: "invalid", raw: "many", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, enabled, err := normalizeListLimit(tt.raw)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !enabled {
				t.Fatalf("expected limit to be enabled")
			}
			if got != tt.want {
				t.Fatalf("limit = %d, want %d", got, tt.want)
			}
		})
	}
}

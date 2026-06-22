package system

import "testing"

func TestListCountUsesRemainingItemCountWhenAvailable(t *testing.T) {
	remaining := int64(37)

	total, partial := listCount(500, &remaining, "next-page")

	if total != 537 {
		t.Fatalf("expected exact total from current + remaining, got %d", total)
	}
	if partial {
		t.Fatal("expected count to be exact when Kubernetes returns remainingItemCount")
	}
}

func TestListCountMarksLowerBoundWhenContinueWithoutRemaining(t *testing.T) {
	total, partial := listCount(500, nil, "next-page")

	if total != 500 {
		t.Fatalf("expected lower-bound count to be current page length, got %d", total)
	}
	if !partial {
		t.Fatal("expected count to be partial when list continues without remainingItemCount")
	}
}

func TestListCountIsExactWhenListIsComplete(t *testing.T) {
	total, partial := listCount(42, nil, "")

	if total != 42 {
		t.Fatalf("expected complete list count, got %d", total)
	}
	if partial {
		t.Fatal("expected count to be exact when there is no continue token")
	}
}

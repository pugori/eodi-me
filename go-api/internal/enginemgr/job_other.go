//go:build !windows

package enginemgr

// AssignToJob is a no-op on non-Windows platforms.
func AssignToJob(_ int) {}

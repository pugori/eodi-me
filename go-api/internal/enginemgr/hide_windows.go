//go:build windows

package enginemgr

import (
	"os/exec"
	"syscall"
)

// hideWindow sets Windows-specific process attributes to prevent
// a console window from appearing when launching the engine subprocess.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}

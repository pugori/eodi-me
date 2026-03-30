//go:build windows

package enginemgr

import (
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	jobHandle windows.Handle
	jobOnce   sync.Once
)

// initJob creates a Windows Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
// When the parent process exits (even on crash), all assigned child processes
// are automatically terminated by the OS.
func initJob() {
	h, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return
	}

	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

	_, err = windows.SetInformationJobObject(
		h,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	)
	if err != nil {
		windows.CloseHandle(h)
		return
	}

	jobHandle = h
}

// AssignToJob assigns a process to the kill-on-close job object.
// Must be called after cmd.Start(). Safe to call multiple times.
func AssignToJob(pid int) {
	jobOnce.Do(initJob)
	if jobHandle == 0 || pid <= 0 {
		return
	}

	h, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false, uint32(pid),
	)
	if err != nil {
		return
	}
	defer windows.CloseHandle(h)

	windows.AssignProcessToJobObject(jobHandle, h)
}

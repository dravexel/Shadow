// ============================================================
// MCP Tool: run_command
// Runs allowlisted commands with user approval and timeout.
// ============================================================

import { spawn } from 'child_process';
import * as path from 'path';
import { ALLOWED_COMMANDS, COMMAND_TIMEOUT_MS } from '../../shared/constants';
import { CommandResult } from '../../shared/types';

interface RunCommandArgs {
  workspaceRoot: string;
  command: string;
  args?: string[];
  cwd?: string;
  onApprovalNeeded: (cmd: string, args: string[]) => Promise<boolean>;
}

export async function handleRunCommand(args: RunCommandArgs): Promise<CommandResult> {
  const { workspaceRoot, command, args: cmdArgs = [], cwd, onApprovalNeeded } = args;

  // Security: Check allowlist
  const baseCommand = command.split(path.sep).pop() || command;
  if (!ALLOWED_COMMANDS.some(a => baseCommand === a || baseCommand.startsWith(a + '.'))) {
    throw new Error(
      `Command '${command}' is not in the allowlist. Allowed: ${ALLOWED_COMMANDS.join(', ')}`
    );
  }

  // Require user approval
  const approved = await onApprovalNeeded(command, cmdArgs);
  if (!approved) {
    throw new Error(`User rejected the command: ${command} ${cmdArgs.join(' ')}`);
  }

  // Execute with timeout
  const workDir = cwd ? path.join(workspaceRoot, cwd) : workspaceRoot;
  return runProcess(command, cmdArgs, workDir);
}

function runProcess(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
      env: { ...process.env },
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 2000);
    }, COMMAND_TIMEOUT_MS);

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({
        stdout: stdout.slice(0, 50_000), // cap output size
        stderr: stderr.slice(0, 10_000),
        exitCode: exitCode ?? -1,
        timedOut,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        stdout: '',
        stderr: String(err),
        exitCode: -1,
        timedOut: false,
      });
    });
  });
}

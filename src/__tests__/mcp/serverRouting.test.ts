import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockTool = jest.fn();
const mockConnect = jest.fn(() => Promise.resolve());

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    tool: mockTool,
    connect: mockConnect,
  })),
}), { virtual: true });

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}), { virtual: true });

type ServerTesting = {
  ACTIVE_INSTANCE_TEMP_FILE: string;
  FOCUSED_INSTANCE_TEMP_FILE: string;
  getSelectionStateFilePathForDocument: (filePath: string, instanceId: string) => string;
  readSelectionsForFile: (filePath: string) => Array<Record<string, unknown>>;
  readSelectionMetadata: () => Record<string, unknown> | null;
  buildFocusedScopedRoutingMetadata: (
    filePath: string | null,
    fieldName: string
  ) => Record<string, unknown> | null;
  buildFocusedSelectionRoutingMetadata: (filePath: string | null) => Record<string, unknown> | null;
};

describe('mcp server focused instance routing', () => {
  let testing: ServerTesting;
  let activeInstanceBackup: string | null;
  let focusedInstanceBackup: string | null;
  let createdInstanceIds: string[];

  const serverModulePath = path.resolve(__dirname, '../../../mcp/server.js');

  const readFileBackup = (filePath: string): string | null =>
    fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;

  const restoreFileBackup = (filePath: string, contents: string | null) => {
    if (contents === null) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
      return;
    }

    fs.writeFileSync(filePath, contents, 'utf8');
  };

  const getInstanceDir = (instanceId: string): string =>
    path.join(os.tmpdir(), `MarkdownForHumans-${instanceId}`);

  const writeJson = (filePath: string, data: object): void => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  };

  const writeSelectionTempFile = (
    instanceId: string,
    data: Record<string, unknown>
  ): void => {
    writeJson(path.join(getInstanceDir(instanceId), 'Selection.json'), data);
  };

  const createInstanceId = (suffix: string): string => {
    const instanceId = `${process.pid}-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
    createdInstanceIds.push(instanceId);
    return instanceId;
  };

  beforeEach(() => {
    jest.resetModules();
    mockTool.mockClear();
    mockConnect.mockClear();
    testing = require(serverModulePath).__testing as ServerTesting;
    activeInstanceBackup = readFileBackup(testing.ACTIVE_INSTANCE_TEMP_FILE);
    focusedInstanceBackup = readFileBackup(testing.FOCUSED_INSTANCE_TEMP_FILE);
    createdInstanceIds = [];

    restoreFileBackup(testing.ACTIVE_INSTANCE_TEMP_FILE, null);
    restoreFileBackup(testing.FOCUSED_INSTANCE_TEMP_FILE, null);
  });

  afterEach(() => {
    restoreFileBackup(testing.ACTIVE_INSTANCE_TEMP_FILE, activeInstanceBackup);
    restoreFileBackup(testing.FOCUSED_INSTANCE_TEMP_FILE, focusedInstanceBackup);

    for (const instanceId of createdInstanceIds) {
      try {
        fs.rmSync(getInstanceDir(instanceId), { recursive: true, force: true });
      } catch {}
    }
  });

  it('reads per-file selection state using the hashed filename written by the extension', () => {
    const instanceId = createInstanceId('hash');
    const filePath = `/workspace/docs/hash-${Date.now()}.md`;
    const selectionState = {
      instance_id: instanceId,
      file: filePath,
      selection: 'Selected text',
      context_before: 'Before',
      context_after: 'After',
      headings_before: ['# Heading'],
    };

    writeJson(
      testing.getSelectionStateFilePathForDocument(filePath, instanceId),
      selectionState
    );

    expect(testing.readSelectionsForFile(filePath)).toEqual([selectionState]);
  });

  it('prefers the focused instance selection over the global active instance selection', () => {
    const focusedInstanceId = createInstanceId('focused');
    const activeInstanceId = createInstanceId('active');

    writeJson(testing.FOCUSED_INSTANCE_TEMP_FILE, {
      instance_id: focusedInstanceId,
      pid: process.pid,
      updated_at: Date.now(),
      file: '/workspace/docs/focused.md',
    });
    writeJson(testing.ACTIVE_INSTANCE_TEMP_FILE, {
      instance_id: activeInstanceId,
      pid: process.pid,
      updated_at: Date.now(),
      file: '/workspace/docs/active.md',
    });

    writeSelectionTempFile(focusedInstanceId, {
      instance_id: focusedInstanceId,
      file: '/workspace/docs/focused.md',
      selection: 'Focused selection',
      context_before: null,
      context_after: null,
      headings_before: [],
    });
    writeSelectionTempFile(activeInstanceId, {
      instance_id: activeInstanceId,
      file: '/workspace/docs/active.md',
      selection: 'Active selection',
      context_before: null,
      context_after: null,
      headings_before: [],
    });

    expect(testing.readSelectionMetadata()).toEqual({
      instance_id: focusedInstanceId,
      file: '/workspace/docs/focused.md',
      selection: 'Focused selection',
      context_before: null,
      context_after: null,
      headings_before: [],
    });
  });

  it('pins file-scoped routing to the focused instance when that file is open there', () => {
    const focusedInstanceId = createInstanceId('route-focused');
    const otherInstanceId = createInstanceId('route-other');
    const filePath = `/workspace/docs/route-${Date.now()}.md`;

    writeJson(testing.FOCUSED_INSTANCE_TEMP_FILE, {
      instance_id: focusedInstanceId,
      pid: process.pid,
      updated_at: Date.now(),
      file: filePath,
    });

    writeJson(
      testing.getSelectionStateFilePathForDocument(filePath, focusedInstanceId),
      {
        instance_id: focusedInstanceId,
        file: filePath,
        selection: null,
        context_before: null,
        context_after: null,
        headings_before: [],
      }
    );
    writeJson(
      testing.getSelectionStateFilePathForDocument(filePath, otherInstanceId),
      {
        instance_id: otherInstanceId,
        file: filePath,
        selection: null,
        context_before: null,
        context_after: null,
        headings_before: [],
      }
    );

    expect(
      testing.buildFocusedScopedRoutingMetadata(filePath, 'source_instance_id')
    ).toEqual({
      file: filePath,
      source_instance_id: focusedInstanceId,
    });

    expect(testing.buildFocusedSelectionRoutingMetadata(filePath)).toEqual({
      file: filePath,
      instance_id: focusedInstanceId,
      source_instance_id: focusedInstanceId,
    });
  });

  it('returns no focused-instance routing when the focused window does not have the target file open', () => {
    const focusedInstanceId = createInstanceId('missing-focused');
    const otherInstanceId = createInstanceId('missing-other');
    const filePath = `/workspace/docs/missing-${Date.now()}.md`;

    writeJson(testing.FOCUSED_INSTANCE_TEMP_FILE, {
      instance_id: focusedInstanceId,
      pid: process.pid,
      updated_at: Date.now(),
      file: '/workspace/docs/other.md',
    });

    writeJson(
      testing.getSelectionStateFilePathForDocument(filePath, otherInstanceId),
      {
        instance_id: otherInstanceId,
        file: filePath,
        selection: null,
        context_before: null,
        context_after: null,
        headings_before: [],
      }
    );

    expect(
      testing.buildFocusedScopedRoutingMetadata(filePath, 'source_instance_id')
    ).toBeNull();
    expect(testing.buildFocusedSelectionRoutingMetadata(filePath)).toBeNull();
  });
});

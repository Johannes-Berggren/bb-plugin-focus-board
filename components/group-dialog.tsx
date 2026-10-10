import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { cn } from "@/lib/utils";
import { normalizeGroupName } from "../lib/group-metadata";

interface GroupDialogProps {
  /** The thread being grouped; names it in the copy. */
  threadTitle: string;
  /** Every registry group (id + name), in registry order. */
  groups: readonly { id: string; name: string }[];
  /** The thread's current group id, null when unassigned. */
  currentGroupId: string | null;
  /** Confirm an existing group pick — one click, picker closes. */
  onPick: (groupId: string) => void;
  /** Confirm the name field with a NEW group, then assign to it. */
  onCreate: (name: string) => void;
  /** Clears the thread's assignment (picker only, when assigned). */
  onRemove?: () => void;
  /** Rename a registry group in place; every member card re-labels. */
  onRename: (groupId: string, name: string) => void;
  /**
   * Delete a registry group outright (a two-step confirm): the record and
   * every member's assignment go together, server-side.
   */
  onDelete: (groupId: string) => void;
  onCancel: () => void;
}

/**
 * The group picker: every existing group as a one-click pick, a name field
 * for a new group (assigned to the thread on confirm, so creation is never
 * a registry write the board never surfaces), a remove action when the
 * thread already carries a group, and per-group rename/delete rows — the
 * picker is the registry's one management surface (rename propagates to
 * every member card through the shared name; delete clears the members'
 * assignments server-side, so archived holders never orphan).
 */
export function GroupDialog({
  threadTitle,
  groups,
  currentGroupId,
  onPick,
  onCreate,
  onRemove,
  onRename,
  onDelete,
  onCancel,
}: GroupDialogProps) {
  const [name, setName] = useState("");
  const validName = normalizeGroupName(name);
  // Row-local management states: one row edits OR arms a delete at a time;
  // pick buttons stay live in every other row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const startRename = (groupId: string, currentName: string) => {
    setDeletingId(null);
    setEditingId(groupId);
    setRenameValue(currentName);
  };
  const closeRowStates = () => {
    setEditingId(null);
    setDeletingId(null);
  };
  const commitRename = (groupId: string) => {
    const settled = normalizeGroupName(renameValue);
    if (settled === null) return; // a blank name keeps the editor open
    onRename(groupId, settled);
    closeRowStates();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-sm" aria-describedby={undefined} data-group-dialog="">
        <DialogHeader>
          <DialogTitle>Group thread</DialogTitle>
          <DialogDescription>
            Sibling threads sharing a group render inside one dashed family
            box on the board — no parent thread involved. A row's pencil
            renames the group everywhere; its trash deletes the group for
            every member.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          “{threadTitle}” {currentGroupId === null ? "joins" : "stays with"}{" "}
          the picked group:
        </p>
        <div className="flex flex-col gap-1.5">
          {groups.map((group) => {
            if (editingId === group.id) {
              return (
                <div key={group.id} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRename(group.id);
                      if (event.key === "Escape") closeRowStates();
                    }}
                    autoFocus
                    aria-label={`Rename group, was ${group.name}`}
                    data-group-rename-input={group.id}
                    maxLength={80}
                    className="w-full flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={normalizeGroupName(renameValue) === null}
                    onClick={() => commitRename(group.id)}
                    data-group-rename-confirm={group.id}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={closeRowStates}
                    data-group-rename-cancel={group.id}
                  >
                    Cancel
                  </Button>
                </div>
              );
            }
            if (deletingId === group.id) {
              return (
                <div
                  key={group.id}
                  className="flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-2 text-sm"
                >
                  <span className="flex-1 truncate">Delete “{group.name}” for all members?</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      onDelete(group.id);
                      closeRowStates();
                    }}
                    data-group-delete-confirm={group.id}
                  >
                    Confirm delete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={closeRowStates}
                    data-group-delete-keep={group.id}
                  >
                    Keep group
                  </Button>
                </div>
              );
            }
            return (
              <div key={group.id} className="group/row flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-0 flex-1 justify-start"
                  onClick={() => onPick(group.id)}
                >
                  <Icon name="Tag" className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="truncate">{group.name}</span>
                  {group.id === currentGroupId ? (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">current</span>
                  ) : null}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity",
                    "group-hover/row:opacity-100 focus-visible:opacity-100",
                  )}
                  onClick={() => startRename(group.id, group.name)}
                  data-group-rename={group.id}
                >
                  <Icon name="Edit" className="size-3.5" aria-hidden />
                  <span className="sr-only">Rename group {group.name}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-7 shrink-0 text-destructive opacity-0 transition-opacity",
                    "group-hover/row:opacity-100 focus-visible:opacity-100",
                  )}
                  onClick={() => {
                    setEditingId(null);
                    setDeletingId(group.id);
                  }}
                  data-group-delete={group.id}
                >
                  <Icon name="Trash2" className="size-3.5" aria-hidden />
                  <span className="sr-only">Delete group {group.name}</span>
                </Button>
              </div>
            );
          })}
          {groups.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground/60">No groups yet.</p>
          ) : null}
        </div>
        <div className="flex items-end gap-1.5">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New group name…"
            aria-label="New group name"
            data-group-name-input=""
            maxLength={80}
            className="w-full flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
          <Button
            size="sm"
            disabled={validName === null}
            onClick={() => {
              if (validName === null) return;
              onCreate(validName);
            }}
            data-group-create=""
          >
            Create & assign
          </Button>
        </div>
        <DialogFooter>
          {currentGroupId !== null && onRemove !== undefined ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              data-group-remove=""
              className="mr-auto text-destructive"
            >
              Remove from group
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onCancel} data-group-cancel="">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// NOTE: the two-step delete is deliberate — a delete strips EVERY member's
// assignment (archived holders included), too wide to fire on one click.
import { type ReactNode, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { MenuPopover, MenuPopoverEntry } from "@/components/menu-popover";
import type { CardMenuAction } from "@/lib/card-menu";

export type { CardMenuAction };

interface ThreadCardMenuProps {
  anchor: ReactNode;
  actions: readonly CardMenuAction[];
  onOpen: () => void;
  href: string;
  /** The thread the menu acts on, shown as the menu's header. */
  title: string;
  /**
   * Open/close reports (the attention freeze): the caller captures the
   * anchor card's placement while the menu holds, and releases on close —
   * whatever path closed it (a run's own close, outside click, Escape).
   */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Right-click menu for a board card, mirroring the sidebar thread menu's
 * relevant actions. Left-click still opens the pane; modified clicks fall
 * through to the anchor's native href behavior. The anchor stops the
 * context-menu event's propagation so a nested card's menu cannot also open
 * its ancestor card's menu — and a boxed card's menu cannot also open its
 * group box's. The popover shell itself is shared (components/menu-popover).
 */
export function ThreadCardMenu({ anchor, actions, onOpen, href, title, onOpenChange }: ThreadCardMenuProps) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  // The open/close reports ride every path, the dismissal mechanics
  // (outside click, Escape, a run's own close) included.
  const openMenu = ({ x, y }: { x: number; y: number }) => {
    setOpen({ x, y });
    onOpenChange?.(true);
  };
  const close = () => {
    if (open !== null) onOpenChange?.(false);
    setOpen(null);
  };
  return (
    <>
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        {anchor}
      </div>
      <MenuPopover open={open} onClose={close} label="Thread actions" title={title}>
        <MenuPopoverEntry
          label="Open thread"
          icon="MessageSquare"
          onRun={() => {
            close();
            onOpen();
          }}
        />
        <MenuPopoverEntry
          label="Copy link to thread"
          icon="Copy"
          onRun={() => {
            close();
            const url = new URL(href, window.location.origin).toString();
            void navigator.clipboard.writeText(url).catch(() => {});
          }}
        />
        {actions.map((action) => (
          <MenuPopoverEntry
            key={action.id}
            label={action.label}
            icon={action.icon}
            onRun={() => {
              close();
              action.run();
            }}
            danger={action.danger}
            dividerAbove={action.dividerAbove}
          />
        ))}
      </MenuPopover>
    </>
  );
}
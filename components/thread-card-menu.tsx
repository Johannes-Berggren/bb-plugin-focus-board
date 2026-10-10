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
}

/**
 * Right-click menu for a board card, mirroring the sidebar thread menu's
 * relevant actions. Left-click still opens the pane; modified clicks fall
 * through to the anchor's native href behavior. The anchor stops the
 * context-menu event's propagation so a nested card's menu cannot also open
 * its ancestor card's menu — and a boxed card's menu cannot also open its
 * group box's. The popover shell itself is shared (components/menu-popover).
 */
export function ThreadCardMenu({ anchor, actions, onOpen, href, title }: ThreadCardMenuProps) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const close = () => setOpen(null);
  return (
    <>
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen({ x: event.clientX, y: event.clientY });
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
import { useId, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DropdownOption } from "./dropdown-search";
import {
  filterDropdownOptions,
  shouldShowDropdownSearch,
} from "./dropdown-search";
import type { FilterState, GroupBy, ThreadState } from "./grouping";
import { GROUP_BY_OPTIONS } from "./grouping";
import { WallpaperDropdown } from "./wallpaper-picker";
import type { WallpaperSettings } from "./preferences";

/**
 * Linear-model dropdown: clicking a row's label applies it as the single
 * selection (and closes); a checkbox appears in the left margin on hover to
 * add the row to a multi-selection without closing. Pass `exclusive` when
 * selections are mutually exclusive: rows replace, never add — no add
 * checkboxes and no Clear row.
 */
interface MultiSelectDropdownProps {
  label: string;
  icon: string;
  selected: ReadonlySet<string>;
  options: readonly DropdownOption[];
  summaryFor: (selected: ReadonlySet<string>) => string;
  /** Omit when `exclusive`: there is nothing to add a row to. */
  onToggle?: (value: string) => void;
  /** Bulk add/remove behind the select-all checkbox beside the search bar:
   *  `add` selects every listed value in one commit, without closing. The
   *  checkbox renders only where a search bar does, so omit this for
   *  dropdowns that never grow one. */
  onToggleMany?: (values: readonly string[], add: boolean) => void;
  onSingleSelect: (value: string) => void;
  /** Omit when `exclusive`: picking another row replaces the selection. */
  onClear?: () => void;
  /** Selections are mutually exclusive (e.g. the View control). */
  exclusive?: boolean;
  /** Mode-chip trigger: drop the "Label:" prefix and show the current
   *  summary as the dominant text — for controls that are a MODE (one
   *  always active), not a narrowing filter. */
  modeChip?: boolean;
  footer?: React.ReactNode;
}

function MultiSelectDropdown({
  label,
  icon,
  selected,
  options,
  summaryFor,
  onToggle,
  onToggleMany,
  onSingleSelect,
  onClear,
  exclusive = false,
  modeChip = false,
  footer,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = `${containerId}-listbox`;
  // Long lists (Project, Provider, and the six-row Group) get a search bar;
  // short ones like State keep their plain rows.
  const searchable = shouldShowDropdownSearch(options);
  const visibleOptions = searchable
    ? filterDropdownOptions(options, query)
    : options;
  // Select-all state, scoped to what the search currently shows: every
  // visible row selected → the next click clears those rows; anything
  // less → the next click completes the visible set. A partial selection
  // renders mixed.
  const selectedVisibleCount = visibleOptions.reduce(
    (count, option) => count + (selected.has(option.value) ? 1 : 0),
    0,
  );
  const allVisibleSelected =
    visibleOptions.length > 0 && selectedVisibleCount === visibleOptions.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const toggleAllVisible = () => {
    if (visibleOptions.length === 0) return;
    onToggleMany?.(
      visibleOptions.map((option) => option.value),
      !allVisibleSelected,
    );
  };
  // The query is a per-visit scratch pad: reopening always starts blank.
  // Closing returns focus to the trigger, since the search input unmounts
  // with the menu and would otherwise drop focus onto the body.
  const close = () => {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  };
  return (
    <div
      className="relative flex"
      id={containerId}
      onKeyDown={(event) => {
        // Only claim Escape while the menu is open; otherwise let it reach
        // bb (closing the panel) as it did before.
        if (!open || event.key !== "Escape") return;
        event.stopPropagation();
        // First Escape wipes a typed filter, second closes the menu.
        if (query !== "") setQuery("");
        else close();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={modeChip ? label : undefined}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground",
          "hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Icon name={icon} className="size-3.5 text-muted-foreground" aria-hidden />
        {modeChip ? (
          /* A mode chip, deliberately not the filter anatomy: the current
             view's name is the whole readable text (no "Label:" prefix) —
             the View is a mode, always exactly one active, and must read
             apart from the narrowing filters. */
          <span className="max-w-40 truncate font-medium text-foreground">
            {summaryFor(selected)}
          </span>
        ) : (
          <>
            <span className="text-muted-foreground">{label}:</span>
            <span className="max-w-40 truncate">{summaryFor(selected)}</span>
          </>
        )}
        <Icon name="ChevronDown" className="size-3 text-muted-foreground" aria-hidden />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden />
          <div className="absolute left-0 top-9 z-50 max-h-80 min-w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
            {/* Search bar: long option lists only. Sticky so it stays put
                while the rows scroll, like bb's model picker. */}
            {searchable ? (
              <div className="sticky top-0 z-10 -mx-1 mb-1 border-b border-border bg-popover px-2 pb-1.5 pt-0.5">
                <div className="flex items-center gap-1.5">
                  {/* Select-all / deselect-all for the rows the search
                      currently shows. Only multi-select dropdowns get it —
                      an exclusive control replaces, never accumulates. */}
                  {!exclusive && onToggleMany !== undefined ? (
                    <button
                      type="button"
                      role="checkbox"
                      data-select-all=""
                      aria-checked={
                        allVisibleSelected ? true : someVisibleSelected ? "mixed" : false
                      }
                      aria-label={
                        allVisibleSelected
                          ? `Deselect all ${label.toLowerCase()} options`
                          : `Select all ${label.toLowerCase()} options`
                      }
                      title={
                        allVisibleSelected
                          ? `Deselect all ${label.toLowerCase()} options`
                          : `Select all ${label.toLowerCase()} options`
                      }
                      onClick={toggleAllVisible}
                      className="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        className={cn(
                          "flex size-3.5 items-center justify-center rounded-[3px] border",
                          allVisibleSelected || someVisibleSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/50 bg-background",
                        )}
                        aria-hidden
                      >
                        {allVisibleSelected || someVisibleSelected ? (
                          <Icon
                            name={someVisibleSelected ? "Minus" : "Check"}
                            className="size-2.5"
                            aria-hidden
                          />
                        ) : null}
                      </span>
                    </button>
                  ) : null}
                  <div className="relative min-w-0 flex-1">
                    <Icon
                      name="Search"
                      className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        // Enter with exactly one filtered match acts like
                        // clicking that row: apply it as the single selection
                        // and close. With 2+ matches Enter stays inert (the
                        // user hasn't narrowed far enough); with none there
                        // is nothing to accept.
                        if (event.key !== "Enter") return;
                        if (visibleOptions.length !== 1) return;
                        event.preventDefault();
                        onSingleSelect(visibleOptions[0].value);
                        close();
                      }}
                      placeholder={`Search ${label.toLowerCase()}…`}
                      aria-label={`Search ${label.toLowerCase()} options`}
                      aria-controls={listboxId}
                      autoFocus
                      className="h-7 pl-7 text-xs"
                    />
                  </div>
                </div>
              </div>
            ) : null}
            <ul id={listboxId} role="listbox" aria-label={label}>
              {visibleOptions.map((option) => {
                const isSelected = selected.has(option.value);
                return (
                  <li
                    key={option.value}
                    className="group/option relative"
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onSingleSelect(option.value);
                        close();
                      }}
                      className={cn(
                        "flex w-full items-center rounded-sm pl-7 pr-2 py-1.5 text-left text-xs",
                        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent",
                      )}
                    >
                      <span className="truncate">{option.label}</span>
                      {isSelected ? (
                        <Icon
                          name="Check"
                          className="absolute left-1.5 size-3.5 shrink-0 opacity-100"
                          aria-hidden
                        />
                      ) : null}
                    </button>
                    {/* Hover checkbox in the left margin: adds to the
                        multi-selection without closing the menu. Exclusive
                        controls hide it — picking a row replaces. */}
                    {!exclusive ? (
                      <span
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={`Add ${option.label} to selection`}
                        tabIndex={isSelected ? -1 : 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggle?.(option.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === " " || event.key === "Enter") {
                            event.preventDefault();
                            event.stopPropagation();
                            onToggle?.(option.value);
                          }
                        }}
                        className={cn(
                          "absolute left-1.5 top-1/2 flex size-3.5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[3px] border",
                          "opacity-0 transition-opacity group-hover/option:opacity-100",
                          "bg-background",
                          isSelected
                            ? "opacity-100 border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/50 hover:border-foreground",
                        )}
                      >
                        {isSelected ? (
                          <Icon name="Check" className="size-2.5" aria-hidden />
                        ) : null}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {/* Sits outside the listbox: not an option, and it only speaks
                when a typed query came up empty (an empty list with no
                query is a different state, not a failed search). */}
            {query.trim() !== "" && visibleOptions.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No {label.toLowerCase()} matches
              </div>
            ) : null}
            {footer !== undefined ? (
              <div className="mt-1 border-t border-border pt-1">{footer}</div>
            ) : null}
            {onClear !== undefined && selected.size > 0 ? (
              <div className="mt-1 border-t border-border pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    close();
                  }}
                  className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Icon name="X" className="size-3.5 shrink-0" aria-hidden />
                  Clear selection
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

interface ProjectDropdownProps {
  projects: readonly PluginSidebarProject[];
  selected: ReadonlySet<string>;
  onToggle: (projectId: string) => void;
  onToggleMany: (projectIds: readonly string[], add: boolean) => void;
  onSingleSelect: (projectId: string) => void;
  onClear: () => void;
  onCreate: (name: string) => Promise<void>;
}

function ProjectDropdown({
  projects,
  selected,
  onToggle,
  onToggleMany,
  onSingleSelect,
  onClear,
  onCreate,
}: ProjectDropdownProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createPending, setCreatePending] = useState(false);

  // Alphabetically sorted; the personal project keeps its own name.
  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const nameFor = (id: string): string =>
    projects.find((project) => project.id === id)?.name ?? id;

  const submitCreate = async () => {
    const name = newName.trim();
    if (name === "" || createPending) return;
    setCreatePending(true);
    try {
      await onCreate(name);
      setNewName("");
      setCreating(false);
    } finally {
      setCreatePending(false);
    }
  };

  return (
    <MultiSelectDropdown
      label="Project"
      icon="Folder"
      selected={selected}
      options={sorted.map((project) => ({ value: project.id, label: project.name }))}
      summaryFor={(current) =>
        current.size === 0
          ? "All projects"
          : current.size === 1
            ? nameFor([...current][0])
            : `${current.size} projects`
      }
      onToggle={onToggle}
      onToggleMany={onToggleMany}
      onSingleSelect={onSingleSelect}
      onClear={onClear}
      footer={
        creating ? (
          <div className="flex items-center gap-1 px-1 py-1">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitCreate();
                } else if (event.key === "Escape") {
                  // Handled here: the menu-level Escape would also fire and
                  // clear the search query behind the create field.
                  event.stopPropagation();
                  setCreating(false);
                  setNewName("");
                }
              }}
              placeholder="Project name"
              aria-label="New project name"
              autoFocus
              className="h-7 text-xs"
            />
            <button
              type="button"
              disabled={createPending || newName.trim() === ""}
              onClick={() => void submitCreate()}
              className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs text-foreground hover:bg-accent disabled:opacity-50"
            >
              <Icon name="Check" className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Icon name="FolderPlus" className="size-3.5 shrink-0" aria-hidden />
            New project…
          </button>
        )
      }
    />
  );
}

interface GroupDropdownProps {
  /** The board's group-bucket rows, labels resolved (registry names plus
   *  the "No group" sentinel; "Unknown group" for a record-less
   *  assignment) — the hide gesture's restore rows live here too. */
  options: readonly { id: string; label: string }[];
  selected: ReadonlySet<string>;
  onToggle: (groupId: string) => void;
  onToggleMany: (groupIds: readonly string[], add: boolean) => void;
  onSingleSelect: (groupId: string) => void;
  onClear: () => void;
}

/**
 * The Group filter, the Project filter's anatomy one bucket over: pick one
 * or more feature-group buckets (the "No group" sentinel and any
 * "Unknown group" lanes included) to restrict the board. The Group view's
 * hide gesture writes through this same selection, so an un-checked row
 * (the hidden group) restores its lane the moment the operator re-checks
 * it.
 */
function GroupDropdown({
  options,
  selected,
  onToggle,
  onToggleMany,
  onSingleSelect,
  onClear,
}: GroupDropdownProps) {
  const labelFor = (id: string): string => options.find((option) => option.id === id)?.label ?? id;
  return (
    <MultiSelectDropdown
      label="Group"
      icon="Ungroup"
      selected={selected}
      options={options.map((option) => ({ value: option.id, label: option.label }))}
      summaryFor={(current) =>
        current.size === 0
          ? "All groups"
          : current.size === 1
            ? labelFor([...current][0])
            : `${current.size} groups`
      }
      onToggle={onToggle}
      onToggleMany={onToggleMany}
      onSingleSelect={onSingleSelect}
      onClear={onClear}
    />
  );
}

interface BoardToolbarProps {
  groupBy: GroupBy;
  onGroupByChange: (value: GroupBy) => void;
  /** R3: "Nest child threads" toggle — nested rendering on/off. */
  nestChildren: boolean;
  onNestChildrenChange: (enabled: boolean) => void;
  /** Parent grouping always renders two-level families: the toggle reads
   *  checked and is greyed out (a depth cap, not a user choice). */
  nestingLocked?: boolean;
  filter: FilterState;
  onFilterChange: (filter: FilterState) => void;
  search: string;
  onSearchChange: (value: string) => void;
  /** Registers the board's search field so a "/" (see useSearchFocusOnSlash)
   *  can move focus to it; owner lives above, in the app shell. */
  searchInputRef?: RefObject<HTMLInputElement | null>;
  projectIds: ReadonlySet<string>;
  providerIds: ReadonlySet<string>;
  projects: readonly PluginSidebarProject[];
  providers: readonly { id: string; displayName?: string }[];
  /** The board's group-bucket options (registry names + the "No group"
   *  sentinel), labels resolved — the Group filter's rows, and the label
   *  source the hide gesture's write-through resolves ids by. */
  groupOptions?: readonly { id: string; label: string }[];
  onCreateProject: (name: string) => Promise<void>;
  totalCount: number;
  onClearFilters: () => void;
  anyFilterActive: boolean;
  onNewThread: () => void;
  /** An update landed since the stored last-seen version — the gift pulses. */
  whatsNewUnseen: boolean;
  /** Opens the settings modal on the asked tab: "whats-new" (pulse click) or "behavior" (gear click). */
  onOpenSettings: (tab: "behavior" | "whats-new") => void;
  /** Board wallpaper behind the panel (global scope for now). */
  wallpaper: WallpaperSettings;
  onWallpaperChange: (next: WallpaperSettings) => void;
}

const STATE_OPTIONS: readonly { value: ThreadState; label: string }[] = [
  { value: "working", label: "Working" },
  { value: "attention", label: "Needs you" },
  { value: "unread", label: "Unread" },
  { value: "idle", label: "Idle" },
];

/** The absent persisted group set (a legacy stored filter): nothing
 *  restricted. Module-level stable so the Group filter's selected-set
 *  identity holds across renders. */
const EMPTY_SET: ReadonlySet<string> = new Set();

export function BoardToolbar({
  groupBy,
  onGroupByChange,
  nestChildren,
  onNestChildrenChange,
  nestingLocked,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  searchInputRef,
  wallpaper,
  onWallpaperChange,
  projectIds,
  providerIds,
  projects,
  providers,
  groupOptions = [],
  onCreateProject,
  totalCount,
  onClearFilters,
  anyFilterActive,
  onNewThread,
  whatsNewUnseen,
  onOpenSettings,
}: BoardToolbarProps) {
  // The View menu's rows (the grouping picker) — named apart from the
  // Group filter's bucket list, which arrives as a prop.
  const groupByOptions = GROUP_BY_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));
  const providerNameFor = (id: string): string =>
    providers.find((provider) => provider.id === id)?.displayName ?? id;
  const providerOptions: DropdownOption[] = [...providerIds]
    .map((id) => ({ value: id, label: providerNameFor(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      {/* Creation leads at the far left, one line like everything else:
          the thread count is board metadata and rides at the row's end with
          the filters, not with the button. New thread opens the board
          composer (components/new-thread-modal, whose header carries the
          maximize hand-off to bb's main new-thread view). */}
      <button
        type="button"
        onClick={onNewThread}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name="Plus" className="size-3.5" aria-hidden />
        New thread
      </button>
      {/* Search pairs with the View menu (the surfaces that change what the
          board shows structurally); fixed width so the search never starves
          the row to wrapping. */}
      <div className="flex items-center gap-2">
        <div className="relative w-44 sm:w-56">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search title or id…"
            aria-label="Search threads"
            className="h-8 pl-7 text-xs"
          />
        </div>
        {/* The View menu: picking a grouping replaces the current one,
            and the "Nest child threads" toggle lives here now — it changes
            how the board structures families, like the grouping. Locked
            under the Parent view, which always nests two levels. */}
        <MultiSelectDropdown
          exclusive
          modeChip
          label="View"
          icon="SlidersHorizontal"
          selected={new Set([groupBy])}
          options={groupByOptions}
          summaryFor={() => GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label ?? groupBy}
          onSingleSelect={(value) => onGroupByChange(value as GroupBy)}
          footer={
            <button
              type="button"
              role="checkbox"
              aria-checked={nestingLocked || nestChildren}
              aria-disabled={nestingLocked || undefined}
              title={
                nestingLocked ? "Parent view always nests two levels" : undefined
              }
              onClick={() => {
                if (nestingLocked) return;
                onNestChildrenChange(!nestChildren);
              }}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs",
                "hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                nestingLocked && "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
            >
              <span
                className={cn(
                  "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                  nestingLocked || nestChildren
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/50 bg-background",
                )}
                aria-hidden
              >
                {nestingLocked || nestChildren ? (
                  <Icon name="Check" className="size-2.5" aria-hidden />
                ) : null}
              </span>
              Nest child threads
            </button>
          }
        />
      </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectDropdown
            projects={projects.filter((project) => projectIds.has(project.id) || !project.isPersonal)}
            selected={filter.projects}
            onToggle={(projectId) => {
              const next = new Set(filter.projects);
              if (next.has(projectId)) next.delete(projectId);
              else next.add(projectId);
              onFilterChange({ ...filter, projects: next });
            }}
            onToggleMany={(projectIds, add) => {
              const next = new Set(filter.projects);
              for (const projectId of projectIds) {
                if (add) next.add(projectId);
                else next.delete(projectId);
              }
              onFilterChange({ ...filter, projects: next });
            }}
            onSingleSelect={(projectId) =>
              onFilterChange({ ...filter, projects: new Set([projectId]) })
            }
            onClear={() => onFilterChange({ ...filter, projects: new Set() })}
            onCreate={onCreateProject}
          />
          <GroupDropdown
            options={groupOptions}
            selected={filter.groups ?? EMPTY_SET}
            onToggle={(groupId) => {
              const next = new Set(filter.groups ?? []);
              if (next.has(groupId)) next.delete(groupId);
              else next.add(groupId);
              onFilterChange({ ...filter, groups: next });
            }}
            onToggleMany={(groupIds, add) => {
              const next = new Set(filter.groups ?? []);
              for (const groupId of groupIds) {
                if (add) next.add(groupId);
                else next.delete(groupId);
              }
              onFilterChange({ ...filter, groups: next });
            }}
            onSingleSelect={(groupId) =>
              onFilterChange({ ...filter, groups: new Set([groupId]) })
            }
            onClear={() => onFilterChange({ ...filter, groups: new Set() })}
          />
          <MultiSelectDropdown
            label="Provider"
            icon="Bot"
            selected={filter.providers}
            options={providerOptions}
            summaryFor={(current) =>
              current.size === 0
                ? "All providers"
                : current.size === 1
                  ? providerNameFor([...current][0])
                  : `${current.size} providers`
            }
            onToggle={(providerId) => {
              const next = new Set(filter.providers);
              if (next.has(providerId)) next.delete(providerId);
              else next.add(providerId);
              onFilterChange({ ...filter, providers: next });
            }}
            onToggleMany={(providerIds, add) => {
              const next = new Set(filter.providers);
              for (const providerId of providerIds) {
                if (add) next.add(providerId);
                else next.delete(providerId);
              }
              onFilterChange({ ...filter, providers: next });
            }}
            onSingleSelect={(providerId) =>
              onFilterChange({ ...filter, providers: new Set([providerId]) })
            }
            onClear={() => onFilterChange({ ...filter, providers: new Set() })}
          />
          <MultiSelectDropdown
            label="State"
            icon="FilterHorizontal"
            selected={filter.states}
            options={STATE_OPTIONS}
            summaryFor={(current) =>
              current.size === 0
                ? "Any state"
                : current.size === 1
                  ? (STATE_OPTIONS.find((option) => option.value === [...current][0])?.label ??
                    "1 state")
                  : `${current.size} states`
            }
            onToggle={(state) => {
              const next = new Set(filter.states);
              if (next.has(state as ThreadState)) next.delete(state as ThreadState);
              else next.add(state as ThreadState);
              onFilterChange({ ...filter, states: next });
            }}
            onSingleSelect={(state) =>
              onFilterChange({ ...filter, states: new Set([state as ThreadState]) })
            }
            onClear={() => onFilterChange({ ...filter, states: new Set() })}
          />
          {anyFilterActive ? (
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex h-8 items-center rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Icon name="X" className="size-3.5" aria-hidden />
              Clear
            </button>
          ) : null}
          {/* Board metadata rides with the filters it describes: the count
              and the settings icon end the filter group, so wrapping carries
              them WITH it — never stranded on an empty right edge. Always
              present — the changelog never becomes unreachable. The icon is
              a double-duty costume with a strictly binary state: unseen
              What's-new content renders the pulsing gift that deep-links to
              that tab; a read board renders the plain settings gear that
              opens on Behavior. The aria-label flips with the costume. */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{totalCount} threads</span>
            <WallpaperDropdown wallpaper={wallpaper} onWallpaperChange={onWallpaperChange} />
            <button
              type="button"
              onClick={() =>
                onOpenSettings(whatsNewUnseen ? "whats-new" : "behavior")
              }
              aria-label={whatsNewUnseen ? "What's new" : "Focus Board settings"}
              title={whatsNewUnseen ? "What's new" : "Focus Board settings"}
              className={cn(
                "-ml-1 inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                whatsNewUnseen
                  ? "motion-safe:animate-pulse text-amber-500 hover:text-amber-400"
                  : "text-muted-foreground",
              )}
            >
              <Icon
                name={whatsNewUnseen ? "Gift" : "Settings"}
                className="size-4"
                aria-hidden
              />
            </button>
          </div>
        </div>
    </div>
  );
}
import { APP_VERSION, type WhatsNewEntry, groupWhatsNewItems } from "@/lib/whats-new";
import { cn } from "@/lib/utils";

/**
 * The condensed changelog feed, as tab content inside the settings modal.
 * It lists the entries it is given — either the delta since the stored
 * last-seen version (after an update), every recent entry (opened unprompted
 * from the gear), or a prerelease build's [Unreleased] group first — and it
 * carries no presentation state of its own: opening it is the caller's
 * signal to mark the version seen (the former standalone modal's side
 * effect, now in app.tsx). Changelog bullets tagged with `#### <surface>`
 * headings group their same-surface items under that label (Added, Changed,
 * and Fixed merge); untagged entries render flat.
 *
 * A dev build's [Unreleased] group renders in amber: that group is the one
 * place the feed mixes old and new (it accumulates between releases), so
 * the lines still becoming true are the amber ones. Released builds show
 * the pending delta whole — every line there is new by construction, so no
 * amber distinction exists to draw.
 */
export function WhatsNewFeed({ entries }: { entries: readonly WhatsNewEntry[] }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">
        {entries.length === 0
          ? `You are on version ${APP_VERSION}.`
          : "Recent changes since you last looked."}
      </p>
      <div className="mt-3" data-whats-new-feed>
        {entries.map((entry) => (
          <section key={entry.version} className="mb-3 last:mb-0">
            <h3
              className={cn(
                "mb-1 text-xs font-semibold",
                entry.unreleased ? "text-amber-500" : "text-foreground",
              )}
            >
              {entry.unreleased ? `Unreleased ${entry.version}` : `Version ${entry.version}`}
            </h3>
            <div key={`ul-${entry.version}`}>
              {groupWhatsNewItems(entry.items).map((group, groupIndex) => (
                <div key={group.label ?? `group-${groupIndex}`}>
                  {group.label !== null && (
                    <div className="mb-1 mt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
                      {group.label}
                    </div>
                  )}
                  <ul
                    className={cn(
                      "list-disc space-y-1 pl-4 text-xs leading-relaxed",
                      entry.unreleased ? "text-amber-500" : "text-muted-foreground",
                    )}
                  >
                    {group.items.map((item) => (
                      <li key={item.lead}>
                        {item.lead}
                        {item.children && item.children.length > 0 && (
                          <ul
                            className={cn(
                              "list-disc mt-1 space-y-1 pl-4",
                              entry.unreleased ? "text-amber-500" : "text-muted-foreground",
                            )}
                          >
                            {item.children.map((child) => (
                              <li key={child}>{child}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

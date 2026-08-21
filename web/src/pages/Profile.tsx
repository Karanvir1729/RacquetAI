import { ArrowLeft, Check, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import {
  EMPTY_PROFILE,
  HANDS,
  LEVELS,
  LEVEL_LABELS,
  loadProfile,
  saveProfile,
  validate,
  type Hand,
  type Level,
  type PlayerProfile,
} from "@/lib/playerProfile";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/**
 * The player profile — the context the coach reads before it says anything.
 *
 * Every field is optional on purpose. A profile that demands your height
 * before it will talk to you is a form, not a coach; this one works with
 * whatever you give it and says plainly what each field buys you.
 */
export default function Profile() {
  const { session, loading } = useAuth();
  const [profile, setProfile] = useState<PlayerProfile>(EMPTY_PROFILE);
  const [state, setState] = useState<"loading" | "ready" | "saving">("loading");
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useDocumentTitle("Your player profile");
  const errors = validate(profile);
  const set = <K extends keyof PlayerProfile>(key: K, value: PlayerProfile[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setSaved(false);
  };

  useEffect(() => {
    if (loading) return;
    if (session === null) {
      setState("ready");
      return;
    }
    let live = true;
    void loadProfile().then((loaded) => {
      if (!live) return;
      if (loaded !== null) setProfile(loaded);
      setState("ready");
    });
    return () => {
      live = false;
    };
  }, [session, loading]);

  const submit = useCallback(async () => {
    if (Object.keys(validate(profile)).length > 0) return;
    setState("saving");
    setFailure(null);
    const message = await saveProfile(profile);
    setState("ready");
    if (message === null) setSaved(true);
    else setFailure(message);
  }, [profile]);

  if (!loading && session === null) {
    return (
      <Shell>
        <Card className="mt-8 p-6 sm:p-8">
          <h2 className="rq-h3">Sign in to build a profile</h2>
          <p className="rq-lead-sm mt-3">
            Your profile is stored against your account so the coach knows who it is talking to —
            and so it follows you to any machine you sign in on.
          </p>
          <div className="mt-7">
            <ButtonLink to="/login" size="md">
              Sign in
            </ButtonLink>
          </div>
        </Card>
      </Shell>
    );
  }

  if (state === "loading") {
    return (
      <Shell>
        <p className="rq-lead-sm mt-8">Loading your profile…</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card className="mt-8 p-6 sm:p-8">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="display-name"
            label="What should the coach call you?"
            value={profile.displayName}
            maxLength={80}
            error={errors.displayName}
            onChange={(e) => set("displayName", e.target.value)}
          />
          <Select
            id="level"
            label="Standard"
            value={profile.level ?? ""}
            onChange={(v) => set("level", (v || null) as Level | null)}
            options={[
              { value: "", label: "Prefer not to say" },
              ...LEVELS.map((l) => ({ value: l, label: LEVEL_LABELS[l] })),
            ]}
          />
          <Field
            id="years"
            label="Years playing"
            type="number"
            min={0}
            max={80}
            value={profile.yearsPlaying ?? ""}
            error={errors.yearsPlaying}
            onChange={(e) => set("yearsPlaying", e.target.value === "" ? null : Number(e.target.value))}
          />
          <Field
            id="per-week"
            label="Sessions a week"
            type="number"
            min={0}
            max={21}
            value={profile.playsPerWeek ?? ""}
            error={errors.playsPerWeek}
            onChange={(e) => set("playsPerWeek", e.target.value === "" ? null : Number(e.target.value))}
          />
          <Select
            id="hand"
            label="Racquet hand"
            value={profile.dominantHand ?? ""}
            onChange={(v) => set("dominantHand", (v || null) as Hand | null)}
            options={[
              { value: "", label: "Prefer not to say" },
              ...HANDS.map((h) => ({ value: h, label: h === "right" ? "Right-handed" : "Left-handed" })),
            ]}
          />
          <Field
            id="height"
            label="Height (cm)"
            type="number"
            min={90}
            max={250}
            value={profile.heightCm ?? ""}
            error={errors.heightCm}
            onChange={(e) => set("heightCm", e.target.value === "" ? null : Number(e.target.value))}
          />
        </div>

        <div className="mt-5 grid gap-5">
          <Area
            id="goals"
            label="What are you working on?"
            hint="The single most useful field here. “Stop dying in long rallies” gets you better advice than any number above."
            value={profile.goals}
            error={errors.goals}
            onChange={(v) => set("goals", v)}
          />
          <Area
            id="injuries"
            label="Anything the coach should work around?"
            hint="Injuries, niggles, a knee that objects to lunging. Left blank, nothing is assumed."
            value={profile.injuries}
            error={errors.injuries}
            onChange={(v) => set("injuries", v)}
          />
        </div>

        {failure !== null ? (
          <p className="rq-lead-sm mt-5" role="alert" style={{ color: "var(--rq-danger)" }}>
            {failure}
          </p>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button
            size="md"
            onClick={() => void submit()}
            disabled={state === "saving" || Object.keys(errors).length > 0}
          >
            {state === "saving" ? "Saving…" : "Save profile"}
          </Button>
          {saved ? (
            <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold"
                  style={{ color: "var(--rq-accent-text)" }} role="status">
              <Check className="h-4 w-4" /> Saved
            </span>
          ) : null}
          <ButtonLink to="/coach" variant="outline" size="md">
            <MessageCircle className="h-4 w-4" /> Talk to the coach
          </ButtonLink>
        </div>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Section divider={false}>
      <div className="mx-auto max-w-3xl">
        <p className="rq-eyebrow">Your player profile</p>
        <h1 className="rq-h2 mt-3">Tell the coach who it's coaching</h1>
        <p className="rq-lead-sm mt-4">
          None of this is required, and nothing here is shared — it is read only when you ask the
          coach something, so its advice is about you rather than about squash in general.
        </p>
        {children}
        <div className="mt-8">
          <ButtonLink to="/" variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back to the overview
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

function Select({
  id, label, value, onChange, options,
}: {
  id: string; label: string; value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="rq-label" style={{ color: "var(--rq-text-dim)" }}>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] w-full rounded-rq-sm border px-3 text-[15px]"
        style={{ borderColor: "var(--rq-line-2)", background: "var(--rq-input)", color: "var(--rq-text)" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function Area({
  id, label, hint, value, error, onChange,
}: {
  id: string; label: string; hint: string; value: string;
  error?: string; onChange: (v: string) => void;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="rq-label" style={{ color: "var(--rq-text-dim)" }}>{label}</span>
      <textarea
        id={id}
        rows={3}
        maxLength={600}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-rq-sm border px-3 py-2.5 text-[15px]"
        style={{
          borderColor: error === undefined ? "var(--rq-line-2)" : "var(--rq-danger)",
          background: "var(--rq-input)", color: "var(--rq-text)",
        }}
      />
      <span className="rq-caption" style={{ color: error === undefined ? "var(--rq-text-faint)" : "var(--rq-danger)" }}>
        {error ?? hint}
      </span>
    </label>
  );
}

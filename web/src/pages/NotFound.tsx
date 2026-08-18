import { ArrowLeft } from "lucide-react";

import { ButtonLink } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export default function NotFound() {
  useDocumentTitle("Page not found");

  return (
    <Section divider={false} className="min-h-[70vh]">
      <div className="mx-auto max-w-xl text-center">
        <p className="rq-eyebrow">404</p>
        <h1 className="rq-h2 mt-3">That page is out of court.</h1>
        <p className="rq-lead mt-4">
          The link you followed does not exist here. The overview has everything.
        </p>
        <div className="mt-8 flex justify-center">
          <ButtonLink to="/" size="lg">
            <ArrowLeft className="h-5 w-5" /> Back to RacquetIQ
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

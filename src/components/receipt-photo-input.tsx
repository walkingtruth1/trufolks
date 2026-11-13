// The receipt photo picker (Stitch receipt drop panel): the whole panel is the
// file input's label. Shared by the scan page (/r/<code>) and Add a review (v1.8).
import { Info, ScanLine } from "lucide-react";
import { btnDark, labelClass, Note } from "@/components/ui";

export /** Stitch's receipt drop panel: the whole panel is the file input's label. */
function PhotoInput({ file, onPick }: { file: File | null; onPick: (file: File | null) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className={labelClass}>
        Photo of your receipt{" "}
        <span className="text-crimson" aria-hidden="true">
          *
        </span>
      </span>
      <label className="flex cursor-pointer flex-col items-center gap-3 bg-tint px-4 py-8 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-secondary">
        <span className="flex h-12 w-12 items-center justify-center bg-secondary/15 text-primary">
          <ScanLine aria-hidden="true" size={26} />
        </span>
        <span className="text-[15px] font-semibold md:text-base">
          {file ? file.name : "Take or choose a photo of your receipt"}
        </span>
        <span className="text-[13px] text-neutral">
          {file ? "Tap to choose a different photo" : "A clear photo from your phone is fine"}
        </span>
        <span className={btnDark + " min-h-9 px-4 py-2"}>
          {file ? "Change photo" : "Choose photo"}
        </span>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
      </label>
      <Note icon={<Info size={18} />}>
        <span className="font-bold">Check it's readable: </span>
        Make sure the business name, date and total are easy to read.
      </Note>
    </div>
  );
}

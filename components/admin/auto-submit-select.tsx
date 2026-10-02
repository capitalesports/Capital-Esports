"use client";

import type { ComponentProps } from "react";
import { NativeSelect } from "@/components/common/native-select";

/** A filter select in a GET form that applies as soon as it changes (the form's button still works without JS). */
export function AutoSubmitSelect(props: ComponentProps<typeof NativeSelect>) {
  return (
    <NativeSelect
      {...props}
      onChange={(e) => {
        props.onChange?.(e);
        e.currentTarget.form?.requestSubmit();
      }}
    />
  );
}

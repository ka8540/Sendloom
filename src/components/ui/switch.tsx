"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import React, { forwardRef } from "react";
import clsx from "clsx";

import styles from "./switch.module.css";

export const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root ref={ref} className={clsx(styles.root, className)} {...props}>
    <SwitchPrimitive.Thumb className={styles.thumb} />
  </SwitchPrimitive.Root>
));

Switch.displayName = "Switch";

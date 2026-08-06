"use client";

import * as React from "react";
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { cn } from "@/lib/utils";

const Form = FormProvider;

function FormField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: String(props.name) }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

type FormItemContextValue = { id: string };

const FormItemContext = React.createContext<FormItemContextValue | null>(null);
const FormFieldContext = React.createContext<{ name: string } | null>(null);

function useFormItem() {
  const context = React.useContext(FormItemContext);

  if (!context) {
    throw new Error("Form components must be rendered inside FormItem");
  }

  return context;
}

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = useFormItem();
  const { getFieldState, formState } = useFormContext();

  if (!fieldContext) {
    throw new Error("Form components must be rendered inside FormField");
  }

  const fieldState = getFieldState(fieldContext.name, formState);

  return {
    ...fieldContext,
    ...itemContext,
    error: fieldState.error,
    formItemId: `${itemContext.id}-form-item`,
    formDescriptionId: `${itemContext.id}-form-item-description`,
    formMessageId: `${itemContext.id}-form-item-message`,
  };
}

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <div className={cn("grid gap-2", className)} {...props} />
    </FormItemContext.Provider>
  );
}

function FormLabel({ className, ...props }: React.ComponentProps<"label">) {
  const { formItemId } = useFormField();

  return (
    <label
      className={cn("text-sm font-medium leading-none", className)}
      htmlFor={formItemId}
      {...props}
    />
  );
}

function FormControl({ className, children, ...props }: React.ComponentProps<"div">) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();

  if (!React.isValidElement(children)) {
    throw new Error("FormControl requires one form control element as its child");
  }

  const control = children as React.ReactElement<
    React.HTMLAttributes<HTMLElement> & { className?: string }
  >;

  return React.cloneElement(control, {
    ...props,
    id: formItemId,
    "aria-describedby": `${formDescriptionId} ${formMessageId}`,
    "aria-invalid": Boolean(error),
    className: cn(control.props.className, className),
  });
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      id={formDescriptionId}
      className={cn("text-sm text-slate-500", className)}
      {...props}
    />
  );
}

function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const message = error?.message?.toString();

  if (!message) {
    return null;
  }

  return (
    <p
      id={formMessageId}
      className={cn("text-sm font-medium text-red-600", className)}
      {...props}
    >
      {message}
    </p>
  );
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
};

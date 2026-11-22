import { dlopen, FFIType, type Pointer } from "bun:ffi";

const LIBOBJC = "/usr/lib/libobjc.A.dylib";

export const cString = (text: string) => Buffer.from(`${text}\0`);

/** What bun:ffi gives back for an Objective-C object, nil being null. */
export type ObjectReference = Pointer | bigint | null;

/** objc_msgSend for messages of one shape: what they take after the receiver and the selector, and what they give back. */
const messageSender = <Arguments extends FFIType[], Returns extends FFIType>(args: [...Arguments], returns: Returns) =>
  dlopen(LIBOBJC, { objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, ...args], returns } }).symbols.objc_msgSend;

function openRuntime() {
  const { symbols } = dlopen(LIBOBJC, {
    objc_getClass: { args: [FFIType.ptr], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.ptr], returns: FFIType.ptr },
  });
  const selector = (name: string) => symbols.sel_registerName(cString(name));
  const perform = messageSender([FFIType.ptr, FFIType.ptr, FFIType.bool], FFIType.void);
  return {
    selector,
    classNamed: (name: string) => symbols.objc_getClass(cString(name)),
    messageSender,
    /** Electrobun runs this code off the main thread, and AppKit takes what changes the app or its windows on the main thread only. */
    sendOnMainThread: (receiver: ObjectReference, message: string, argument: ObjectReference) =>
      perform(receiver, selector("performSelectorOnMainThread:withObject:waitUntilDone:"), selector(message), argument, false),
  };
}

let runtime: ReturnType<typeof openRuntime> | null = null;

/** The way to AppKit for what Electrobun has no call for. macOS only. */
export const objectiveC = () => (runtime ??= openRuntime());

// Suppress only DEP0060 emitted by htmlencode before matrix-bot-sdk loads.
const originalEmitWarning = process.emitWarning.bind(process);

process.emitWarning = ((...args: unknown[]) => {
  const optionsOrType = args[1];
  const positionalCode = args[2];
  const code =
    (typeof positionalCode === "string" ? positionalCode : undefined) ??
    (typeof optionsOrType === "object" && optionsOrType !== null
      ? (optionsOrType as Record<string, unknown>).code
      : undefined);

  if (code === "DEP0060") return;
  return Reflect.apply(originalEmitWarning, process, args);
}) as typeof process.emitWarning;

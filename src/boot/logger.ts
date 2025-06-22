import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";

export function createLogger<
  CustomLevels extends string = never,
  UseOnlyCustomLevels extends boolean = boolean,
>(
  optionsOrStream?:
    | LoggerOptions<CustomLevels, UseOnlyCustomLevels>
    | DestinationStream,
): Logger<CustomLevels, UseOnlyCustomLevels> {
  return pino(optionsOrStream);
}

export default createLogger({});

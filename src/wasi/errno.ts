export const ERRNO_BADF = 8;
export const ERRNO_EXIST = 20;
export const ERRNO_INVAL = 28;
export const ERRNO_ISDIR = 31;
export const ERRNO_NOENT = 44;
export const ERRNO_NOSYS = 52;
export const ERRNO_NOTDIR = 54;
export const ERRNO_NOTEMPTY = 55;
export const ERRNO_NOTCAPABLE = 76;

export function errnoName(errno: number): string {
  switch (errno) {
    case ERRNO_BADF:
      return "BADF";
    case ERRNO_EXIST:
      return "EXIST";
    case ERRNO_INVAL:
      return "INVAL";
    case ERRNO_ISDIR:
      return "ISDIR";
    case ERRNO_NOENT:
      return "NOENT";
    case ERRNO_NOSYS:
      return "NOSYS";
    case ERRNO_NOTDIR:
      return "NOTDIR";
    case ERRNO_NOTEMPTY:
      return "NOTEMPTY";
    case ERRNO_NOTCAPABLE:
      return "NOTCAPABLE";
    default:
      return "UNKNOWN";
  }
}

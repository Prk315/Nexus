import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from ".";

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector = <T>(fn: (s: RootState) => T) => useSelector(fn);

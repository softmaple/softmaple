import { DropdownMenuItem } from "@softmaple/ui/components/dropdown-menu.tsx";
import type { FC } from "react";

export type ExportFormat = "markdown" | "latex";

export type ExportFilesMenuItemProps = {
  format: ExportFormat;
  isDownloading: boolean;
  onClick: (format: ExportFormat) => void;
  icon: React.ReactNode;
  label: string;
};

export const ExportFilesMenuItem: FC<ExportFilesMenuItemProps> = ({
  format,
  isDownloading,
  onClick,
  icon,
  label,
}) => (
  <DropdownMenuItem disabled={isDownloading} onClick={() => onClick(format)}>
    {icon}
    {label}
  </DropdownMenuItem>
);

type Props = {
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
  /** 悬停与读屏文案 */
  label?: string;
};

export function PageRefreshButton({
  onClick,
  disabled,
  spinning,
  label = "重新加载",
}: Props) {
  return (
    <button
      type="button"
      className={`btn-icon page-refresh-btn${spinning ? " page-refresh-btn--spinning" : ""}`}
      title={label}
      aria-label={label}
      aria-busy={spinning || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        className="page-refresh-btn__icon"
        viewBox="0 0 24 24"
        width={18}
        height={18}
        aria-hidden
      >
        <path
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

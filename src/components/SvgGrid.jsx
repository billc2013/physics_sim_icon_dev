import SvgCard from "./SvgCard.jsx";

// Grid of SvgCards plus the "no matches" empty state.
export default function SvgGrid({ items, onItemClick }) {
  if (items.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "3rem 1rem",
          color: "var(--color-text-tertiary)",
          fontSize: 14,
        }}
      >
        No matches. Click a filter to solo it, click again to show all.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
        gap: 10,
      }}
    >
      {items.map((item) => (
        <SvgCard key={item.id} item={item} onClick={() => onItemClick(item)} />
      ))}
    </div>
  );
}

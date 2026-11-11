const filler = new Set(
  "what which who when where why how did do does have has had i you we me us my our your the a an to of about for on in is are was were it its this that these those earlier before previously last please asked ask said say tell remember recall tools tool".split(
    " ",
  ),
);
export function memorySearchQuery(question: string) {
  const terms = [...new Set(question.match(/[\p{L}\p{N}]+/gu) || [])].filter(
    (term) => term.length > 2 && !filler.has(term.toLowerCase()),
  );
  return terms.slice(0, 8).join(" OR ");
}

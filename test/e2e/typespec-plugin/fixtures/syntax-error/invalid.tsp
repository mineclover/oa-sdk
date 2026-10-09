import "@typespec/http";

using Http;

namespace BrokenApi;

model InvalidModel {
  id: NonExistentType;
  brokenSyntax = = = 123;
}
